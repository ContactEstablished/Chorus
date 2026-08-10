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

### Exhibit 2 — `src/main/services/councilService.ts` (lines 1–1164, 56242 bytes)

```ts
   1  import { randomUUID } from 'node:crypto'
   2  import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
   3  import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
   4  import { buildMintRequest } from './attributionCore'
   5  import secretPatterns from './secret-patterns.json'
   6  import { createApiSession, type TokenUsage } from './apiSession'
   7  import {
   8    assembleRun,
   9    computeRunAccounting,
  10    nextAction,
  11    routeAcceptsMintedKey,
  12    type AssemblyCandidate,
  13    type CouncilAction,
  14    type CouncilPhase,
  15    type CouncilState,
  16    type CouncilTranscriptEntry,
  17    type PlannedMember,
  18    type PlannedRun,
  19    type RunAccounting,
  20    type TurnRecord
  21  } from './councilCore'
  22  import { logger } from './logger'
  23  import type { OpenRouterKeyClient } from './openrouterKeys'
  24  import { createSessionOutput } from './sessionOutput'
  25  import {
  26    COUNCIL_RUN_ABANDONED,
  27    COUNCIL_RUN_CANCELLED,
  28    COUNCIL_RUN_COMPLETE,
  29    COUNCIL_RUN_FAILED,
  30    COUNCIL_RUN_RUNNING,
  31    type StorageService
  32  } from './storage'
  33  
  34  /**
  35   * Task 3b-3: the council orchestrator — I/O ONLY.
  36   *
  37   * ⚠ IT CONTAINS NO `if` THAT DECIDES WHAT HAPPENS NEXT IN THE DELIBERATION.
  38   * Every such decision is `councilCore.nextAction`'s, and this file's whole job
  39   * is to perform the actions it returns, persist the results, and feed them
  40   * back. The branches below are all about I/O outcomes — a mint failed, a stream
  41   * refused, the user cancelled — never about what the council should ask next.
  42   *
  43   * ⚠ IT ALSO OWNS NO TRANSPORT AND NO SCRUBBER. Every request goes through
  44   * `createApiSession` (D45(2)/D63 Q1) and every byte of model text goes through
  45   * `createSessionOutput().ingest()` (D63 Q4/(d)). A "just for the arbiter"
  46   * client is the shape this fails in: it looks like reasonable specialization
  47   * and it forks the one mechanism the whole app's api mode is being built on.
  48   *
  49   * ── THE MONEY, IN ONE PLACE ──────────────────────────────────────────────
  50   * One minted OpenRouter key per RUN (D64(2)), created before the first request
  51   * and destroyed after the last one, on EVERY exit path. Every member's request
  52   * carries that key rather than the member's own credential, so the run has a
  53   * single bounded spend surface. Read usage back, THEN revoke — always in that
  54   * order, because revocation is a `DELETE` and a deleted key's usage may no
  55   * longer be readable (3a-3).
  56   */
  57  
  58  /* ------------------------------------------------------------------ */
  59  /* Tunables — argued, not chosen                                       */
  60  /* ------------------------------------------------------------------ */
  61  
  62  /**
  63   * ⚠ A PRE-AUTHORIZATION CEILING, NOT A BUDGET, AND THE ARITHMETIC IS BELOW.
  64   *
  65   * OpenRouter pre-authorizes each request against the key's REMAINING limit and
  66   * refuses it outright before doing any work (measured 2026-07-25, Task 3a-3):
  67   *
  68   *   402 Payment Required: This request requires more credits, or fewer
  69   *   max_tokens. You requested up to 65536 tokens, but can only afford 46666.
  70   *
  71   * That implies ≈$0.0000107 per allocated output token at the model 3a-3
  72   * measured — a frontier rate, far above what this task's drive models charge.
  73   * The cap must therefore clear the run's COMBINED max output allocation, since
  74   * `remaining` shrinks as the run proceeds and the LAST request must still
  75   * pre-authorize.
  76   *
  77   * ⚠ RAISED $1.00 → $5.00 → $10.00 ON 2026-07-26, EACH TIME WITH THE ARITHMETIC
  78   * REDONE RATHER THAN THE NUMBER NUDGED, because the council's roster moved to
  79   * real frontier models and then its arbiter's allowance doubled.
  80   *
  81   * **$5.00 → $10.00 is the arbiter's 32,000-token allowance, priced.** At $25/M
  82   * out, one arbiter request now pre-authorizes 32,000 × $25/M = **$0.80**, and
  83   * the arbiter takes TWO turns (arbitration, then synthesis) — so $1.60 of
  84   * pre-authorization has to remain available at the LAST of them, on top of
  85   * everything the members already spent. Measured against the real run this is
  86   * sized from: it billed **$0.5586** with the arbiter at 16,000, and the arbiter
  87   * was ~90% of that. Doubling its allowance puts a realistic run near $1.00 and a
  88   * worst case near $3.00. $10.00 clears that ≈3×, which is the same headroom
  89   * ratio $5.00 gave the previous configuration — the ratio is the argument, not
  90   * the number.
  91   *
  92   * The rates below are MEASURED, from OpenRouter's own free and unauthenticated
  93   * `GET /api/v1/models` on 2026-07-26 — not remembered:
  94   *
  95   *   moonshotai/kimi-k3        $3.00/M in · $15.00/M out   ⚠ reasoning
  96   *   z-ai/glm-5.2              $0.67/M in ·  $2.10/M out   ⚠ reasoning
  97   *   qwen/qwen3-coder          $0.30/M in ·  $1.00/M out
  98   *   anthropic/claude-opus-5   $5.00/M in · $25.00/M out   ⚠ reasoning  (ARBITER)
  99   *
 100   *   worst case per request : the ARBITER's 32,000 × $25.00/M
 101   *                          = $0.80   ← the priciest participant, twice per run
 102   *   worst case per run     : 3 members × 2 turns at 16,000 + arbiter × 2 turns
 103   *                            at 32,000, every one spending its whole allocation
 104   *                          ≈ $2.20 output + ≈$0.40 input ≈ $2.60
 105   *   realistic run          : ≈$1.00, extrapolated from the $0.5586 measured at
 106   *                            the arbiter's previous 16,000 allowance
 107   *
 108   * $10.00 clears the worst case ≈4×, and the headroom is what keeps `remaining`
 109   * above the NEXT request's pre-authorization all the way to the last turn.
 110   * **At $1.00 it did not:** a single 16,000-token arbiter request pre-authorized
 111   * 40% of that whole cap, so the run would have taken a 402 part-way through —
 112   * after paying for everything before it.
 113   *
 114   * ⚠ THE HONEST LIMIT OF THIS NUMBER: IT CLEARS THE SHIPPED FOUR-PARTICIPANT
 115   * ROSTER, NOT `MAX_COUNCIL_PARTICIPANTS`. Twelve participants across four rounds
 116   * is ≈50 requests, and at $0.80 each that is ≈$40 — four times this cap. **A
 117   * large council on frontier models WILL 402**, and that is left as a loud
 118   * failure rather than papered over with a bigger number, because a cap sized to
 119   * the worst imaginable council is a cap that has stopped bounding anything.
 120   * Raise it deliberately if that council is ever configured — not from whoever
 121   * next hits the refusal.
 122   *
 123   * ⚠ AND F34 IS WHY THE HEADROOM IS NOT WASTE — IT NOW APPLIES TO THREE OF THE
 124   * FOUR. `kimi-k3`, `glm-5.2` and `claude-opus-5` are all REASONING models, and
 125   * OpenRouter bills reasoning tokens as OUTPUT tokens. Measured in Task 3b-1 on
 126   * kimi-k3 itself: a probe capped at 60 returned exactly 60 output tokens with an
 127   * EMPTY answer. `createApiSession` yields only `delta.content` by design, so
 128   * that spend is invisible in the transcript while being charged in full. The cap
 129   * must clear the reasoning budget PLUS the answer, not merely "the answer".
 130   *
 131   * What this number bounds is the worst case of ONE orphaned key, and that worst
 132   * case is bounded twice more: by `expires_at`, and by the boot reconcile — which
 133   * as of D66 can finally see a council run at all. **Raising it to $5.00 raises
 134   * the blast radius of one abandoned key from $1 to $5, and that is the real cost
 135   * of this change, stated rather than buried.**
 136   */
 137  export const COUNCIL_MINT_LIMIT_USD = 10.0
 138  
 139  /** `expires_at` = mint + this. Shorter than a dispatch's 12 h because a council
 140   *  run is minutes, not a working session. The third orphan defence and the
 141   *  weakest of the three (D4 obligation 5 could not confirm OpenRouter stops
 142   *  honouring a key at that instant), so nothing here leans on it. */
 143  export const COUNCIL_MINT_TTL_MS = 60 * 60 * 1000
 144  
 145  /**
 146   * ⚠ THE ONLY REQUEST PARAMETER THIS SERVICE SENDS, AND THE DECISION IS STATED
 147   * RATHER THAN IMPLIED (`ImplementationSpec-3b-2.md` §8 left it open).
 148   *
 149   * `createApiSession` builds its body from exactly four things — `model`,
 150   * `messages`, `stream`, and an optional `max_tokens`. There is no channel for
 151   * `temperature`, `top_p` or anything else, and opening one means editing
 152   * `apiSession.ts`, which this task must leave byte-identical. So:
 153   *
 154   *   · `max_tokens` from a member's `params_json` IS honoured, clamped to the
 155   *     bounds below — it is the one parameter F34 makes consequential;
 156   *   · every OTHER key in `params_json` is stored, read, and DELIBERATELY NOT
 157   *     SENT. Widening that needs a transport change, which is a raise.
 158   *
 159   * Silently dropping them would be the wrong half of that: the log line in
 160   * `driveMember` names them, so a user who set `temperature` learns it did
 161   * nothing instead of believing it did something.
 162   */
 163  export const MAX_OUTPUT_TOKENS_DEFAULT = 1200
 164  
 165  /**
 166   * ⚠ RAISED TWICE ON MEASURED EVIDENCE, AND THE SECOND RAISE IS BECAUSE THE FIRST
 167   * ONE DID NOT FINISH THE JOB (both 2026-07-26).
 168   *
 169   * **4,000 → 16,000.** The cheap-fixture dogfood run returned EXACTLY 700 output
 170   * tokens on four of its eight turns — the members' configured `max_tokens` — and
 171   * the arbiter's synthesis stopped mid-sentence, so the findings document never
 172   * reached its rulings, risks or action items (F38). A cap a turn hits exactly is
 173   * a cap that truncated it.
 174   *
 175   * **16,000 → 32,000.** The frontier-roster run then hit 16,000 EXACTLY on BOTH
 176   * arbiter turns and truncated again — mid-sentence, ~95% through instead of ~5%.
 177   * The document grew 7,316 → 32,510 bytes (larger than the externally-produced
 178   * findings it is measured against) but the ceiling was still the binding
 179   * constraint, not the model. **Raising it moved the truncation; it did not
 180   * remove it, and the second raise is an attempt to, not a proof that it did.**
 181   *
 182   * ⚠ NEITHER NUMBER IS ARBITRARY — EACH IS READ OFF THE ROSTER. From OpenRouter's
 183   * free, unauthenticated `GET /api/v1/models` on 2026-07-26,
 184   * `top_provider.max_completion_tokens`: `anthropic/claude-opus-5` (the ARBITER)
 185   * **128,000**, `z-ai/glm-5.2` 131,072, `qwen/qwen3-coder` **65,536**, and
 186   * `moonshotai/kimi-k3` **UNSTATED — OpenRouter publishes no limit for it at
 187   * all**, which is its own risk. 32,000 clears the smallest published limit on
 188   * the roster (qwen's 65,536) with room, and sits well inside the arbiter's own.
 189   *
 190   * ⚠ IT IS A CLAMP, NOT A REQUEST, and the per-member `params_json` is what
 191   * actually binds. The arbiter is set to 32,000 because it writes the document;
 192   * the members stay at 16,000 because measurement says they do not need more —
 193   * the largest member answer observed was 11,796 output tokens.
 194   *
 195   * ⚠ AND IT IS COUPLED TO TWO OTHER NUMBERS. Raising it without raising
 196   * COUNCIL_MINT_LIMIT_USD produces a 402 part-way through a paid-for run; raising
 197   * it without raising COUNCIL_TURN_TIMEOUT_MS times out the reasoning models that
 198   * needed the room. Both have happened, live, in that order. **Do not move this
 199   * one alone.**
 200   */
 201  const MAX_OUTPUT_TOKENS_CEILING = 32_000
 202  const MAX_OUTPUT_TOKENS_FLOOR = 200
 203  
 204  /**
 205   * ⚠ THE COUNCIL DECLARES ITS OWN DEADLINE INSTEAD OF INHERITING THE TRANSPORT'S,
 206   * AND A LIVE RUN IS WHY (2026-07-26).
 207   *
 208   * `apiSession.ts` defaults to `RESPONSE_TIMEOUT_MS = 120_000` and its own
 209   * docstring names the risk exactly: *"a reasoning model's FIRST token can
 210   * legitimately take a minute"*, and the bound covers **the whole cycle**, not
 211   * the gap between chunks. That default was measured against 700-token turns.
 212   *
 213   * **Measured after the ceiling rose to 16,000 and the roster moved to frontier
 214   * models: `moonshotai/kimi-k3` and `z-ai/glm-5.2` — both REASONING models —
 215   * BOTH returned `The response exceeded its time limit and was stopped.` on the
 216   * positions round, while `qwen/qwen3-coder` (non-reasoning) answered in 1,479
 217   * output tokens well inside the limit.** Two of three members lost, the refusal
 218   * floor tripped, and the run aborted having paid for what it did get. **Raising
 219   * the output ceiling without raising the deadline is what produced that: the two
 220   * knobs are coupled, and only one of them was moved.**
 221   *
 222   * ⚠ IT IS SET HERE, NOT IN `apiSession.ts`. The transport's 120 s is right for a
 223   * caller that wants a quick answer, and a future interactive chat pane is that
 224   * caller. The council is the one that hands a reasoning model a 16,000-token
 225   * allowance and should therefore be the one that waits for it — so the default
 226   * stays where it is and this overrides it, rather than every consumer inheriting
 227   * the council's patience.
 228   *
 229   * ⚠ RAISED 10 → 15 MINUTES WHEN THE ARBITER'S ALLOWANCE DOUBLED TO 32,000.
 230   * Generation time scales with tokens produced, so doubling the allowance roughly
 231   * doubles the turn — and the arbiter's 16,000-token turns already ran several
 232   * minutes each in the measured run. Leaving the deadline at 10 while doubling
 233   * the output is the SAME mistake as the first raise, one configuration later.
 234   * **These two numbers move together or the run dies at the more expensive end.**
 235   *
 236   * The cost of being wrong in this direction is bounded and visible: positions
 237   * and critique are issued as CONCURRENT batches, so a run's worst case is four
 238   * sequential waits (positions → critique → arbitration → synthesis), not eight —
 239   * ≈60 minutes — and `cancel()` aborts every in-flight member at once.
 240   */
 241  const COUNCIL_TURN_TIMEOUT_MS = 15 * 60 * 1000
 242  
 243  /** The transcript ring per member. Generous — a position is prose, not a log. */
 244  const MEMBER_BUFFER_CHARS = 200_000
 245  const MEMBER_FLUSH_MS = 50
 246  
 247  /**
 248   * ⚠ A RUNAWAY GUARD, NOT A PROTOCOL RULE. If `nextAction` ever returns `ask`
 249   * for something already answered, the loop below would spin forever making
 250   * billable calls. This bounds that, and it bounds nothing else: the protocol's
 251   * own round structure is the core's business and is expected to terminate well
 252   * inside it. Exceeding this is a BUG, and it aborts loudly rather than
 253   * completing quietly with whatever it had.
 254   */
 255  const MAX_PROTOCOL_STEPS = 24
 256  
 257  /** The cap's arithmetic above assumes a bounded council. Stated as a refusal so
 258   *  the assumption is checkable rather than implied. */
 259  export const MAX_COUNCIL_PARTICIPANTS = 12
 260  
 261  /**
 262   * ⚠ A COST BOUND WEARING A FILE-SIZE HAT. A brief is a document; a multi-megabyte
 263   * file is either a mistake or an attack on the cost envelope, because EVERY
 264   * MEMBER PAYS INPUT TOKENS FOR EVERY BYTE and three of the four phases carry the
 265   * brief. The number is the one `council:start` already enforced as a string
 266   * length in 3b-3, kept deliberately so the boundary did not move when the input
 267   * changed from text to a path. For calibration: the largest real brief in this
 268   * repo is 36 KB.
 269   */
 270  export const MAX_BRIEF_BYTES = 200_000
 271  
 272  /* ------------------------------------------------------------------ */
 273  /* The brief's path — A SECURITY BOUNDARY, and it lives in MAIN        */
 274  /* ------------------------------------------------------------------ */
 275  
 276  export type BriefPathCheck =
 277    | { readonly ok: true; readonly path: string }
 278    | { readonly ok: false; readonly reason: string }
 279  
 280  /**
 281   * ⚠ A RENDERER-SUPPLIED PATH THAT MAIN OPENS IS AN ARBITRARY-FILE-READ
 282   * PRIMITIVE. The dialog is a convenience; THIS is the boundary, and it re-checks
 283   * everything the dialog was supposed to guarantee because the renderer can call
 284   * `council:start` with any string at all.
 285   *
 286   * ⚠ NO REFUSAL ECHOES THE PATH. Not the supplied one and certainly not the
 287   * resolved one: a resolved relative path would leak main's cwd, and a message
 288   * naming a fragment the caller did not supply is a message that tells an
 289   * attacker something. The user knows which file they just chose; the refusal
 290   * only has to say what is wrong with it.
 291   *
 292   * The order is `ImplementationSpec-3b-4.md` §1's, each returning before the next
 293   * is attempted, and the filesystem is not touched until the cheap refusals are
 294   * exhausted.
 295   */
 296  export function validateBriefPath(raw: string): BriefPathCheck {
 297    const refuse = (reason: string): BriefPathCheck => ({ ok: false, reason })
 298  
 299    if (typeof raw !== 'string' || raw.trim() === '') return refuse('No brief was chosen.')
 300    // 1. A relative path resolves against MAIN's cwd, which is not the user's
 301    //    mental model and is a different directory in dev and in a packaged build.
 302    if (!isAbsolute(raw)) return refuse('A brief must be an absolute path.')
 303    // 2. Before the filesystem is touched. Node throws on an embedded NUL, and a
 304    //    thrown error is a worse refusal than a named one.
 305    if (raw.includes('\0')) return refuse('That path contains a null byte.')
 306    // 3. ⚠ ALSO BEFORE THE FILESYSTEM. `statSync` on a UNC path can block on SMB
 307    //    for as long as the network takes, so a hostile path would be a hang
 308    //    rather than a refusal. A network share is a different trust surface than
 309    //    a local file and this feature has no reason to read one.
 310    if (isUncPath(raw)) return refuse('A brief must be a local path, not a network share.')
 311    // 4. Narrow by construction: the feature reads briefs.
 312    if (extname(raw).toLowerCase() !== '.md') return refuse('A brief must be a .md file.')
 313  
 314    // ⚠ NORMALIZE, THEN RE-CHECK — checking before normalizing checks the wrong
 315    // string. A `..` that resolves to a real .md file is fine and the NORMALIZED
 316    // path is what everything downstream uses; a `..` that resolves to something
 317    // else is caught here rather than opened.
 318    const path = resolve(raw)
 319    if (!isAbsolute(path) || path.includes('\0') || isUncPath(path)) {
 320      return refuse('That path does not resolve to a local absolute path.')
 321    }
 322    if (extname(path).toLowerCase() !== '.md') return refuse('That path does not resolve to a .md file.')
 323  
 324    let size: number
 325    try {
 326      // 5. ⚠ `statSync().isFile()`, NOT `existsSync` — which passes a DIRECTORY.
 327      //    That is the `session:launch` cwd check's own lesson, paid for once.
 328      const stat = statSync(path)
 329      if (!stat.isFile()) return refuse('That path is not a file.')
 330      size = stat.size
 331    } catch {
 332      return refuse('That file does not exist, or cannot be read.')
 333    }
 334    // 6. The cost bound.
 335    if (size > MAX_BRIEF_BYTES) {
 336      return refuse(
 337        `That brief is ${Math.round(size / 1024)} KB; the limit is ${Math.round(MAX_BRIEF_BYTES / 1024)} KB. ` +
 338          `Every council member pays input tokens for every byte of it.`
 339      )
 340    }
 341    return { ok: true, path }
 342  }
 343  
 344  /** `\\server\share` and `//server/share`. Kept separate from the checks above
 345   *  so both the raw and the normalized form can ask the same question. */
 346  function isUncPath(candidate: string): boolean {
 347    return /^[\\/]{2}/.test(candidate)
 348  }
 349  
 350  /**
 351   * ⚠ THE FINDINGS PATH IS COMPUTED, NEVER SUPPLIED — and that is the whole
 352   * security argument of this task, not a convenience.
 353   *
 354   * A second renderer-supplied path would be an arbitrary-file-WRITE primitive,
 355   * which is strictly worse than the read one above: a read leaks, a write
 356   * destroys. Deriving the output from the one validated input removes that
 357   * primitive as a CLASS rather than guarding it, so there is one boundary to get
 358   * right instead of two.
 359   *
 360   * `extname` rather than the literal `'.md'` so a `BRIEF.MD` loses its extension
 361   * too — `basename(p, '.md')` is case-sensitive on the suffix and would emit
 362   * `BRIEF.MD-Findings.md`.
 363   */
 364  export function findingsPathFor(briefPath: string): string {
 365    return join(dirname(briefPath), `${basename(briefPath, extname(briefPath))}-Findings.md`)
 366  }
 367  
 368  /**
 369   * ⚠ THE OVERWRITE RULING, MADE EXPLICITLY (spec §6 left it open): CHORUS NEVER
 370   * OVERWRITES A FINDINGS FILE. It suffixes — `-Findings-2.md`, `-Findings-3.md` —
 371   * and the first free name wins.
 372   *
 373   * The two rejected alternatives, and why:
 374   *  · OVERWRITE silently destroys the record §4 exists to keep. A second council
 375   *    on the same brief is exactly when you want to compare the two, and it is
 376   *    the one moment the old file is deleted.
 377   *  · REFUSE THE RUN when the file exists is worse than it sounds, because by
 378   *    the time findings exist the deliberation is already paid for. Throwing away
 379   *    a completed run over a filename is the D67(b) mistake in a different suit.
 380   *
 381   * Returns NULL when even the suffixes are exhausted, so the caller reports a
 382   * failure rather than picking a name by improvisation. `taken` is injected so
 383   * the ruling is testable without a filesystem.
 384   */
 385  export function nextFreeFindingsPath(
 386    briefPath: string,
 387    taken: (candidate: string) => boolean
 388  ): string | null {
 389    const first = findingsPathFor(briefPath)
 390    if (!taken(first)) return first
 391    const stem = first.slice(0, -'.md'.length)
 392    for (let n = 2; n <= 99; n++) {
 393      const candidate = `${stem}-${n}.md`
 394      if (!taken(candidate)) return candidate
 395    }
 396    return null
 397  }
 398  
 399  /* ------------------------------------------------------------------ */
 400  /* The sanitization pre-pass (D63(f))                                  */
 401  /* ------------------------------------------------------------------ */
 402  
 403  /** ⚠ A HIT NAMES ITS PATTERN AND ITS LINE AND NOTHING ELSE. There is no field
 404   *  here for the matched text, deliberately — a shape that cannot carry the
 405   *  secret cannot leak it into a log, a refusal or the view. */
 406  export interface BriefSecretHit {
 407    readonly pattern: string
 408    /** 1-based, so it matches what the user's editor shows. */
 409    readonly line: number
 410  }
 411  
 412  /**
 413   * Scan a brief for known credential shapes BEFORE any member sees it.
 414   *
 415   * ⚠ WHY THE SCRUBBER CANNOT DO THIS. `SessionOutput`'s scrubber exact-matches
 416   * REGISTERED values — the run's minted key — and a key a user typed into their
 417   * own brief was never registered with anything. So the brief is scanned by
 418   * SHAPE, using `secret-patterns.json`: the SAME file `logger.ts` compiles for
 419   * `scrubSecrets` and `scripts/secret-grep.mjs` reads for the G4 gate. Authoring
 420   * a second list here would let the gate and the sanitizer test different shapes,
 421   * which is the exact drift that file's header exists to prevent. ZERO new
 422   * pattern literals live in this file.
 423   *
 424   * ⚠ AND THE CLAIM IT LICENSES IS BOUNDED. It catches known shapes. It cannot
 425   * catch a credential that looks like prose, a partial key, or a shape no pattern
 426   * covers — which is why the sentence the UI ships says exactly that and never
 427   * says the brief is safe.
 428   */
 429  export function scanBriefForSecrets(text: string): readonly BriefSecretHit[] {
 430    const hits: BriefSecretHit[] = []
 431    const lines = text.split('\n')
 432    for (let i = 0; i < lines.length; i++) {
 433      for (const pattern of secretPatterns.patterns) {
 434        // Compiled per line rather than once with /g: a `g` regex carries
 435        // `lastIndex` between calls, and a stateful matcher in a loop skips
 436        // matches. Cheap enough — six patterns over a document, once per run.
 437        if (new RegExp(pattern.source).test(lines[i])) {
 438          hits.push({ pattern: pattern.name, line: i + 1 })
 439        }
 440      }
 441    }
 442    return hits
 443  }
 444  
 445  /**
 446   * ⚠ THE HIT RULING, MADE EXPLICITLY (spec §6 left it open): A HIT REFUSES THE
 447   * RUN. It does not redact and proceed.
 448   *
 449   * Redacting would quietly change the text several models are about to reason
 450   * about — corrupting the deliberation — and it would bury the warning under a
 451   * run that appears to have worked. A user who wrote a key into a brief needs to
 452   * know BEFORE five models read it and before a transcript of it is persisted.
 453   *
 454   * The message names the PATTERN and the LINE. It never names the value: a
 455   * refusal that echoes the secret it found is a leak wearing a warning's clothes,
 456   * and this string reaches both a log file and the view.
 457   */
 458  export function describeSecretHits(hits: readonly BriefSecretHit[]): string {
 459    const where = hits.map((h) => `line ${h.line} (${h.pattern})`).join(', ')
 460    return (
 461      `This brief looks like it contains a credential, so the run was refused before any model read it: ` +
 462      `${where}. Remove it from the brief and run again. ` +
 463      `The value itself is deliberately not shown here — this message is written to the log.`
 464    )
 465  }
 466  
 467  /* ------------------------------------------------------------------ */
 468  /* Deps                                                                */
 469  /* ------------------------------------------------------------------ */
 470  
 471  /** What the pre-flight learned about one member's route. ⚠ NO KEY MATERIAL:
 472   *  the plaintext this resolution decrypted is dropped at the call site. */
 473  export interface MemberRoute {
 474    readonly baseUrl: string
 475    /** Non-secret metadata, carried so the credential handed to the transport is
 476     *  shaped honestly rather than with an invented variable name. */
 477    readonly envVarName: string
 478  }
 479  
 480  export interface CouncilProgressEvent {
 481    readonly runId: string
 482    readonly phase: CouncilPhase
 483    readonly round: number
 484    readonly memberId: string | null
 485    /** ⚠ SCRUBBED. It comes from `SessionOutput`'s `onText`, never from the raw
 486     *  stream — see `driveMember`. */
 487    readonly delta: string
 488  }
 489  
 490  export interface CouncilServiceDeps {
 491    readonly storage: StorageService
 492    /** ⚠ THE SAME CLIENT `DispatchAttribution` HOLDS, threaded from `index.ts`.
 493     *  Not a second one: a second client means a second management-key path, and
 494     *  the management key's decrypt-per-use discipline has exactly one home. */
 495    readonly keys: OpenRouterKeyClient
 496    readonly hasManagementKey: () => boolean
 497    /**
 498     * ⚠ `ipc.ts`'s OWN `resolveCredential`, REUSED AND NEVER FORKED — all five
 499     * ordered refusals, with the management refusal still sitting BEFORE
 500     * decryption (D58/D60).
 501     *
 502     * It returns only the ROUTE, because the route is the only thing this service
 503     * needs from it. The credential it decrypts is DISCARDED at the call site:
 504     * every request carries the run's minted key instead, so the member's own key
 505     * is decrypted and thrown away. That is deliberate and it is the price of not
 506     * forking the refusal ladder — the alternative is a second, shorter ladder
 507     * that drifts from the first.
 508     */
 509    readonly resolveMemberRoute: (
 510      credentialProfileId: string
 511    ) => Promise<{ ok: true; route: MemberRoute | null } | { ok: false; reason: string }>
 512    readonly emitProgress: (event: CouncilProgressEvent) => void
 513    /** The gateway the minted key authenticates against. Injected so the pure
 514     *  core never learns a URL and this file never hard-codes a second one. */
 515    readonly gatewayBaseUrl: string
 516    readonly now?: () => Date
 517  }
 518  
 519  export type CouncilStartResult =
 520    | {
 521        readonly ok: true
 522        readonly runId: string
 523        readonly findings: string
 524        readonly accounting: RunAccounting
 525        readonly costUsd: number | null
 526        /** Where the findings actually landed, or NULL when the write failed —
 527         *  never a path that does not exist. */
 528        readonly findingsPath: string | null
 529        /** ⚠ THE REASON BESIDE THE NULL, on D55's principle one layer over: an
 530         *  absent path with no explanation is the same unreadable fact as a cost
 531         *  with no denominator. NULL when the write succeeded. */
 532        readonly findingsError: string | null
 533      }
 534    | { readonly ok: false; readonly reason: string }
 535  
 536  export interface CouncilService {
 537    /** ⚠ THE PATH IS THE INPUT, AND MAIN IS WHAT OPENS IT (3b-4). 3b-3 took brief
 538     *  TEXT from the renderer; that is gone, not deprecated. */
 539    start(input: { projectId: string | null; briefPath: string }): Promise<CouncilStartResult>
 540    /** Returns false when there is no such live run — a cancel for a finished run
 541     *  is not an error, it is a race the user cannot see. */
 542    cancel(runId: string): boolean
 543    /**
 544     * `app 'before-quit'`. ⚠ SYNCHRONOUS AND HONEST ABOUT ITS LIMITS: it aborts
 545     * every in-flight request and marks the run abandoned, but it CANNOT complete
 546     * a network revoke — `before-quit` does not await, and the process is about to
 547     * die. The ledger row therefore stays OPEN, which is exactly what makes the
 548     * boot reconcile the backstop for this one path (D66). Claiming a quit-time
 549     * revocation here would be claiming something the runtime cannot deliver.
 550     */
 551    abandonOpenRunsOnQuit(): void
 552  }
 553  
 554  interface LiveRun {
 555    readonly runId: string
 556    readonly controller: AbortController
 557    cancelled: boolean
 558  }
 559  
 560  export function createCouncilService(deps: CouncilServiceDeps): CouncilService {
 561    const now = deps.now ?? ((): Date => new Date())
 562    const live = new Map<string, LiveRun>()
 563  
 564    /* ---------------------------------------------------------------- */
 565  
 566    async function start(input: {
 567      projectId: string | null
 568      briefPath: string
 569    }): Promise<CouncilStartResult> {
 570      // ── 0. The file boundary and the pre-pass. ────────────────────────────
 571      // ⚠ FIRST, AND THAT ORDERING IS THE CLAIM. Everything here happens with
 572      // nothing minted, nothing spent, no row written and no model having seen a
 573      // byte — which is what makes "refused before any model read it" a fact
 574      // about the control flow rather than a sentence in a message.
 575      const checked = validateBriefPath(input.briefPath)
 576      if (!checked.ok) return { ok: false, reason: checked.reason }
 577  
 578      let briefText: string
 579      try {
 580        briefText = readFileSync(checked.path, 'utf8')
 581      } catch (err) {
 582        // The path statted a moment ago; losing it here is a race or a permission
 583        // problem, and either way the user gets a sentence rather than a throw.
 584        logger.error({ err }, '[council] the brief could not be read after validation')
 585        return { ok: false, reason: 'That brief could not be read.' }
 586      }
 587  
 588      const hits = scanBriefForSecrets(briefText)
 589      if (hits.length > 0) {
 590        const reason = describeSecretHits(hits)
 591        // Safe to log: `describeSecretHits` carries pattern names and line
 592        // numbers and structurally cannot carry the matched value.
 593        logger.warn(`[council] ${reason}`)
 594        return { ok: false, reason }
 595      }
 596  
 597      if (!deps.hasManagementKey()) {
 598        return {
 599          ok: false,
 600          reason:
 601            'A council run needs an OpenRouter management key to mint the capped key that bounds its spend. Add one in Settings.'
 602        }
 603      }
 604  
 605      // ── 1. Assembly. PURE, and before anything is spent or created. ───────
 606      const assembly = assembleRun(loadCandidates(), briefText, deps.gatewayBaseUrl)
 607      if (!assembly.ok) return { ok: false, reason: assembly.reason }
 608      const run = assembly.run
 609      const participants = [...run.members, run.arbiter]
 610      if (participants.length > MAX_COUNCIL_PARTICIPANTS) {
 611        return {
 612          ok: false,
 613          reason: `A council is limited to ${MAX_COUNCIL_PARTICIPANTS} participants; this one has ${participants.length}.`
 614        }
 615      }
 616  
 617      // ── 2. Pre-flight: resolve every route BEFORE minting. ────────────────
 618      // ⚠ ORDER MATTERS AND IT IS ABOUT MONEY. Every refusal below happens with
 619      // nothing minted and nothing spent. Discovering a bad route after the mint
 620      // would leave a funded key to clean up for a run that never began.
 621      const routes = new Map<string, MemberRoute>()
 622      for (const member of participants) {
 623        const resolved = await deps.resolveMemberRoute(member.credentialProfileId)
 624        if (!resolved.ok) {
 625          return { ok: false, reason: `Council member '${member.label}': ${resolved.reason}` }
 626        }
 627        if (resolved.route === null) {
 628          return { ok: false, reason: `Council member '${member.label}' has no base URL to send a request to.` }
 629        }
 630        // ⚠ RE-CHECKED AGAINST THE EFFECTIVE ROUTE, not the provider row.
 631        // A credential envelope may override the provider's base URL (D33(e)), so
 632        // the URL assembly saw and the URL the request goes to are not guaranteed
 633        // to be the same one. The minted key is only valid at the gateway, and
 634        // this is the check that sees what will actually be dialled.
 635        if (!routeAcceptsMintedKey(resolved.route.baseUrl, deps.gatewayBaseUrl)) {
 636          return {
 637            ok: false,
 638            reason:
 639              `Council member '${member.label}' resolves to a route outside the OpenRouter gateway, so it cannot use ` +
 640              `the single capped key that bounds this run's spend.`
 641          }
 642        }
 643        routes.set(member.memberId, resolved.route)
 644      }
 645  
 646      // ── 3. Mint. ONE key for the whole run (D64(2)). ──────────────────────
 647      const runId = randomUUID()
 648      const mintedAt = now()
 649      const request = buildMintRequest({
 650        owner: { kind: 'council', runId },
 651        limitUsd: COUNCIL_MINT_LIMIT_USD,
 652        now: mintedAt,
 653        ttlMs: COUNCIL_MINT_TTL_MS
 654      })
 655      if (!request.ok) {
 656        // The refusal path that guarantees no uncapped council key can exist.
 657        return { ok: false, reason: `Could not start the run: ${request.reason}` }
 658      }
 659      const minted = await deps.keys.mint(request.body)
 660      if (!minted.ok) {
 661        // ⚠ A MINT FAILURE REFUSES THE RUN — it does NOT degrade to the members'
 662        // own keys. That is the deliberate opposite of `mintForDispatch`, and the
 663        // boundary is exact: there, attribution is telemetry over a launch that
 664        // must not be blocked; here, the minted key IS the spend bound, so running
 665        // without it would be running unbounded.
 666        return { ok: false, reason: `Could not start the run: ${minted.reason}` }
 667      }
 668      if (minted.value.limit === null || !(minted.value.limit > 0)) {
 669        // A mint that came back WITHOUT a limit is a mint we do not trust — the
 670        // cap is the whole blast-radius bound. Revoke and refuse.
 671        logger.error('[council] OpenRouter returned a key with no positive limit; revoking immediately')
 672        await revokeQuietly(minted.value.hash)
 673        return { ok: false, reason: 'Could not start the run: the provider returned a key with no spend limit.' }
 674      }
 675      const mintedKey = minted.value.key
 676  
 677      // The write-ahead ledger row. `revoked_at` NULL IS the open-row predicate
 678      // the boot reconcile queries — the same definition v8 uses, deliberately,
 679      // and as of D66 actually read.
 680      deps.storage.createCouncilRun({
 681        id: runId,
 682        projectId: input.projectId,
 683        // ⚠ THE NORMALIZED PATH, not the string the renderer sent. The row, the
 684        // findings file's location and the boundary check all read the same one.
 685        briefPath: checked.path,
 686        findingsPath: null,
 687        status: COUNCIL_RUN_RUNNING,
 688        startedAt: mintedAt.toISOString(),
 689        endedAt: null,
 690        mintedKeyHash: minted.value.hash,
 691        mintedKeyLimit: minted.value.limit,
 692        mintedAt: mintedAt.toISOString(),
 693        revokedAt: null,
 694        tokensIn: null,
 695        tokensOut: null,
 696        tokensCached: null,
 697        costUsd: null
 698      })
 699      logger.info(
 700        `[council] run ${runId} opened · ${run.members.length} member(s) + 1 arbiter · key capped at $${minted.value.limit}`
 701      )
 702  
 703      const controller = new AbortController()
 704      const liveRun: LiveRun = { runId, controller, cancelled: false }
 705      live.set(runId, liveRun)
 706  
 707      const turns: TurnRecord[] = []
 708      let transcript: readonly CouncilTranscriptEntry[] = []
 709      let outcome: { kind: 'complete'; findings: string } | { kind: 'abort'; reason: string } = {
 710        kind: 'abort',
 711        reason: 'The run ended without reaching a conclusion.'
 712      }
 713  
 714      try {
 715        // ── 4. The protocol loop. EVERY decision below is the core's. ───────
 716        for (let step = 0; step < MAX_PROTOCOL_STEPS; step++) {
 717          // ⚠ `runId` and `startedAt` are PROVENANCE the core renders and cannot
 718          // derive: it has no clock and no uuid source (D68(2)). Both are already
 719          // on the ledger row above, so the findings file and the DB agree by
 720          // construction rather than by two independent stamps.
 721          const state: CouncilState = {
 722            run,
 723            transcript,
 724            cancelled: liveRun.cancelled,
 725            runId,
 726            startedAt: mintedAt.toISOString()
 727          }
 728          const actions = nextAction(state)
 729          const terminal = actions.find((a): a is Extract<CouncilAction, { kind: 'complete' | 'abort' }> =>
 730            a.kind !== 'ask'
 731          )
 732          if (terminal) {
 733            outcome = terminal.kind === 'complete' ? { kind: 'complete', findings: terminal.findings } : terminal
 734            break
 735          }
 736          const asks = actions.filter((a): a is Extract<CouncilAction, { kind: 'ask' }> => a.kind === 'ask')
 737          if (asks.length === 0) {
 738            outcome = { kind: 'abort', reason: 'The protocol returned no next step.' }
 739            break
 740          }
 741  
 742          // ⚠ THE BLIND ROUND, MADE REAL. Every ask in this batch is issued
 743          // concurrently, so no member's request can contain another's answer —
 744          // none of those answers exists yet. Awaiting them in sequence and
 745          // feeding each into the next is precisely what the array shape exists
 746          // to make impossible to do by accident.
 747          const results = await Promise.all(
 748            asks.map((ask) => driveMember(ask, run, routes, mintedKey, liveRun))
 749          )
 750          // ⚠ PERSISTED IMMEDIATELY, INCLUDING THE REFUSALS. A batch that is held
 751          // in memory until the run ends is a batch a cancel or a crash loses —
 752          // and the transcript is the only artefact that can show a run was
 753          // partial. Written here rather than inside `driveMember` so every DB
 754          // write in this file lives on one path.
 755          for (const result of results) persistTurn(runId, result)
 756          transcript = [...transcript, ...results.map((r) => r.entry)]
 757          turns.push(...results.map((r) => r.record))
 758        }
 759      } catch (err) {
 760        // A protocol-loop throw must still reach the `finally` below, which is
 761        // the only thing standing between a crash and a live funded key.
 762        logger.error({ err }, `[council] run ${runId} failed mid-deliberation`)
 763        outcome = { kind: 'abort', reason: 'The run failed part-way through.' }
 764      } finally {
 765        live.delete(runId)
 766      }
 767  
 768      // ── 5. Read usage back, THEN revoke. ALWAYS in that order. ────────────
 769      const costUsd = await settle(runId, minted.value.hash, liveRun.cancelled, outcome.kind)
 770  
 771      const accounting = computeRunAccounting({ membersPlanned: participants.length, turns })
 772      logger.info(
 773        `[council] run ${runId} ${outcome.kind === 'complete' ? 'complete' : 'aborted'} · ` +
 774          `${accounting.membersAnswered}/${accounting.membersPlanned} members answered · ${accounting.membersRefused} refused · ` +
 775          `${accounting.turnsAnswered} turn(s) answered, ${accounting.turnsRefused} refused · ` +
 776          `usage reported for ${accounting.usageReported}, absent for ${accounting.usageAbsent} · ` +
 777          `cost ${costUsd === null ? 'UNKNOWN' : '$' + costUsd}`
 778      )
 779  
 780      if (outcome.kind === 'abort') return { ok: false, reason: outcome.reason }
 781  
 782      // ── 6. The findings file, beside the brief and nowhere else. ──────────
 783      // ⚠ AFTER THE REVOKE, DELIBERATELY. A full disk or a read-only directory
 784      // must never sit between a live funded key and its revocation; the findings
 785      // text is already in hand and travels back on the response either way.
 786      const written = writeFindings(runId, checked.path, outcome.findings)
 787      return { ok: true, runId, findings: outcome.findings, accounting, costUsd, ...written }
 788    }
 789  
 790    /**
 791     * ⚠ THE ONE AND ONLY FINDINGS WRITE IN THIS FILE, and its path was DERIVED
 792     * from the validated brief path — never supplied by anyone.
 793     *
 794     * It never throws and never overwrites: a run that deliberated successfully
 795     * and then could not write a file still returns its findings, with the
 796     * failure named rather than swallowed.
 797     */
 798    function writeFindings(
 799      runId: string,
 800      briefPath: string,
 801      findings: string
 802    ): { findingsPath: string | null; findingsError: string | null } {
 803      const target = nextFreeFindingsPath(briefPath, (candidate) => existsSync(candidate))
 804      if (target === null) {
 805        return {
 806          findingsPath: null,
 807          findingsError:
 808            'There are already 99 findings files beside this brief, so Chorus stopped rather than overwrite one.'
 809        }
 810      }
 811      try {
 812        writeFileSync(target, findings, 'utf8')
 813      } catch (err) {
 814        logger.error({ err }, `[council] could not write the findings file for run ${runId}`)
 815        return {
 816          findingsPath: null,
 817          findingsError:
 818            'The findings could not be written beside the brief. They are shown here and stored in the run transcript.'
 819        }
 820      }
 821      try {
 822        deps.storage.updateCouncilRun(runId, { findingsPath: target })
 823      } catch (err) {
 824        // The file is on disk; a ledger write failing does not un-write it.
 825        logger.error({ err }, `[council] findings written but the run row could not record the path`)
 826      }
 827      logger.info(`[council] run ${runId} findings written to ${target}`)
 828      return { findingsPath: target, findingsError: null }
 829    }
 830  
 831    /* ---------------------------------------------------------------- */
 832  
 833    /**
 834     * Drive ONE member's turn. The sequence is `ImplementationSpec-3b-3.md` §4's,
 835     * and three things it gets right would break under a rearrangement:
 836     *
 837     *  · `output.flush()` BEFORE persisting, or the scrubber's held carry — the
 838     *    partial tail it withholds in case it is the prefix of a secret — never
 839     *    reaches the transcript;
 840     *  · `handle.dispose()` in a `finally`, or a member that throws mid-stream
 841     *    leaves an HTTP request running and spending;
 842     *  · ONE `SessionOutput` PER MEMBER. A scrubber holds a carry across chunk
 843     *    boundaries, so sharing one across members would interleave two streams
 844     *    through one carry and corrupt both.
 845     */
 846    async function driveMember(
 847      ask: Extract<CouncilAction, { kind: 'ask' }>,
 848      run: PlannedRun,
 849      routes: ReadonlyMap<string, MemberRoute>,
 850      mintedKey: string,
 851      liveRun: LiveRun
 852    ): Promise<{ entry: CouncilTranscriptEntry; record: TurnRecord }> {
 853      const member = [...run.members, run.arbiter].find((m) => m.memberId === ask.memberId)
 854      const route = routes.get(ask.memberId)
 855      if (!member || !route) {
 856        // Unreachable: the core only asks members assembly planned. Recorded as a
 857        // refusal rather than thrown, because a transcript that is missing a turn
 858        // is worse than one that says the turn failed.
 859        return refusal(ask, 'This member could not be resolved for the run.')
 860      }
 861  
 862      let refused: string | null = null
 863      let usage: TokenUsage | null = null
 864      const handle = createApiSession(
 865        {
 866          sessionId: `${liveRun.runId}:${member.memberId}:${ask.phase}:${ask.round}`,
 867          modelId: member.model,
 868          // ⚠ THE MINTED KEY, NOT THE MEMBER'S OWN. This is what gives the run one
 869          // bounded spend surface. The member's credential was decrypted during
 870          // the pre-flight — for its refusals and for its route — and discarded
 871          // there; `envVarName` below is the only thing that survived it, and it
 872          // is not secret.
 873          credential: { envVarName: route.envVarName, value: mintedKey, isSecret: true }
 874        },
 875        {
 876          baseUrl: route.baseUrl,
 877          maxOutputTokens: resolveMaxOutputTokens(member),
 878          // ⚠ COUPLED TO `MAX_OUTPUT_TOKENS_CEILING`. A member allowed 16,000
 879          // output tokens cannot also be held to the transport's 120 s default —
 880          // measured, not predicted: two reasoning members timed out on exactly
 881          // that combination.
 882          maxWallClockMs: COUNCIL_TURN_TIMEOUT_MS,
 883          // Session-scoped external abort: cancelling the RUN aborts every member
 884          // at once without this loop tracking each handle (D63 Q3's note).
 885          signal: liveRun.controller.signal,
 886          // D63(g): both facts arrive on the FACTORY's contract, never through the
 887          // text stream — a refusal or a usage total yielded as text would flow
 888          // through the scrubber and be rendered as though the model had said it.
 889          onUsage: (u) => {
 890            usage = u
 891          },
 892          onRefusal: (r) => {
 893            refused = r
 894          },
 895          // ⚠ THE F39 INSTRUMENT (D96, Task 3e-1). A DIAGNOSTIC — it changes no
 896          // bound. It exists because F39's question ("is kimi pathological, or is
 897          // the 4 MB cap too small for a model that streams its chain of
 898          // thought?") has two opposite fixes and was UNANSWERABLE from outside:
 899          // the byte count was compared to the cap and then discarded.
 900          //
 901          // ⚠ EVERY TURN LOGS, NOT ONLY THE CAPPED ONES, and that is what makes
 902          // this a measurement rather than an anecdote — the capped figure is
 903          // read AGAINST the largest successful one. Logged at `warn` when the
 904          // cap fired so it surfaces without a filter, `info` otherwise.
 905          //
 906          // ⚠ THE LABEL IS THE MEMBER'S, THE PHASE'S AND THE ROUND'S — never the
 907          // route, the env var name or any key material — and NO STREAM CONTENT
 908          // APPEARS HERE. Model output can carry a credential; a diagnostic that
 909          // leaked one would be worse than the defect it measures.
 910          onStreamBytes: ({ bytes, capBytes, capped }) => {
 911            const where = `${member.label} · ${ask.phase} · round ${ask.round}`
 912            if (capped) {
 913              logger.warn(
 914                `[council] stream CAPPED: ${where} — ${bytes} bytes against a ${capBytes} byte cap`
 915              )
 916            } else {
 917              logger.info(`[council] stream bytes: ${where} — ${bytes} of ${capBytes} allowed`)
 918            }
 919          }
 920        }
 921      )
 922  
 923      // ⚠ THE SEAM (D45(1)/D46/D63 Q4). The factory emits raw text; THIS scrubs
 924      // it, with the run's minted key registered as a secret. Omitting that
 925      // registration leaves a wired-but-inert seam that passes every structural
 926      // check — which is why 3b-1's drive 5 planted a secret and asserted the
 927      // INGESTED text came back redacted.
 928      //
 929      // Honest coverage wording (F27, sharpened by D63 Q4): Chorus redacts
 930      // registered exact values on ingest; it cannot redact values an agent
 931      // derives, and it cannot redact content it was asked to read.
 932      const output = createSessionOutput({
 933        secrets: [mintedKey],
 934        maxChars: MEMBER_BUFFER_CHARS,
 935        flushMs: MEMBER_FLUSH_MS,
 936        // ⚠ THE PROGRESS BROADCAST'S ONLY SOURCE. Wiring it to the raw stream
 937        // instead would bypass the seam at the last possible moment, which is
 938        // exactly where it would be least visible in review.
 939        onText: (delta) =>
 940          deps.emitProgress({
 941            runId: liveRun.runId,
 942            phase: ask.phase,
 943            round: ask.round,
 944            memberId: member.memberId,
 945            delta
 946          })
 947      })
 948  
 949      try {
 950        await handle.send(ask.prompt)
 951        for await (const chunk of handle.receive()) output.ingest(chunk)
 952        output.flush()
 953      } catch (err) {
 954        logger.error({ err }, `[council] member ${member.memberId} failed mid-stream`)
 955        refused = refused ?? 'The response stream failed.'
 956      } finally {
 957        await handle.dispose()
 958        output.dispose()
 959      }
 960  
 961      if (refused !== null) return refusal(ask, refused, usage)
 962      if (output.buffer.trim() === '') {
 963        // ⚠ F34's SIGNATURE, AND IT LOOKS EXACTLY LIKE A BROKEN TRANSPORT. A
 964        // reasoning model can consume the entire output cap on reasoning tokens
 965        // and emit no `delta.content` at all — billed in full, answer empty. It is
 966        // recorded as a refusal with its own wording so the transcript says which
 967        // of the two happened.
 968        return refusal(ask, 'The model returned an empty answer (its output budget may have gone to reasoning).', usage)
 969      }
 970      return {
 971        entry: {
 972          memberId: member.memberId,
 973          round: ask.round,
 974          phase: ask.phase,
 975          content: output.buffer,
 976          outcome: 'answered'
 977        },
 978        record: { memberId: member.memberId, outcome: 'answered', usage }
 979      }
 980    }
 981  
 982    function refusal(
 983      ask: Extract<CouncilAction, { kind: 'ask' }>,
 984      reason: string,
 985      usage: TokenUsage | null = null
 986    ): { entry: CouncilTranscriptEntry; record: TurnRecord } {
 987      // ⚠ PERSISTED LIKE ANY OTHER TURN. A council that ran with three of five
 988      // members must SAY so in its own transcript; an absent row is an absence
 989      // nobody downstream can distinguish from a smaller council.
 990      return {
 991        entry: { memberId: ask.memberId, round: ask.round, phase: ask.phase, content: reason, outcome: 'refused' },
 992        record: { memberId: ask.memberId, outcome: 'refused', usage }
 993      }
 994    }
 995  
 996    /* ---------------------------------------------------------------- */
 997  
 998    /**
 999     * Read the key's usage, then revoke it, then close the ledger row.
1000     *
1001     * ⚠ NEVER THROWS, because it is called from a path that has already decided
1002     * the run's outcome. A settle failure leaves `revoked_at` NULL, which is not a
1003     * loss — it is the open-row predicate, and the boot reconcile is the backstop
1004     * (bounded meanwhile by the key's own cap).
1005     */
1006    async function settle(
1007      runId: string,
1008      hash: string,
1009      cancelled: boolean,
1010      outcomeKind: 'complete' | 'abort'
1011    ): Promise<number | null> {
1012      let costUsd: number | null = null
1013      try {
1014        // 1. READ FIRST, always. Revocation is a DELETE and whether usage survives
1015        //    it is UNDOCUMENTED (D4 obligation 6); reading first makes the
1016        //    question irrelevant.
1017        const usage = await deps.keys.readUsage(hash)
1018        costUsd = usage.ok ? usage.value.usageUsd : null
1019        if (!usage.ok) logger.warn(`[council] usage read failed; revoking anyway: ${usage.reason}`)
1020  
1021        // 2. Revoke. This matters more than the number above.
1022        const revoked = await deps.keys.revoke(hash)
1023        const status = cancelled
1024          ? COUNCIL_RUN_CANCELLED
1025          : outcomeKind === 'complete'
1026            ? COUNCIL_RUN_COMPLETE
1027            : COUNCIL_RUN_FAILED
1028        deps.storage.updateCouncilRun(runId, {
1029          status,
1030          endedAt: new Date().toISOString(),
1031          costUsd,
1032          // ⚠ NULL ON A FAILED REVOKE, DELIBERATELY. "We called revoke" and "the
1033          // key is gone" are different claims, and writing a timestamp for the
1034          // first would tell the boot reconcile there is nothing left to do.
1035          revokedAt: revoked.ok ? new Date().toISOString() : null
1036        })
1037        if (!revoked.ok) {
1038          logger.error(`[council] revoke FAILED for run ${runId}; the ledger row stays open: ${revoked.reason}`)
1039        }
1040      } catch (err) {
1041        logger.error({ err }, `[council] settle failed for run ${runId}; the ledger row stays open`)
1042      }
1043      return costUsd
1044    }
1045  
1046    async function revokeQuietly(hash: string): Promise<void> {
1047      const result = await deps.keys.revoke(hash)
1048      if (!result.ok) {
1049        logger.error(`[council] could not revoke a key we cannot use; the boot reconcile will catch it: ${result.reason}`)
1050      }
1051    }
1052  
1053    /**
1054     * One transcript row. `member_id` is carried even for a refusal — the row's
1055     * whole value is saying WHICH member did not answer.
1056     *
1057     * ⚠ THE TOKEN COLUMNS TAKE `null` WHEN THE PROVIDER REPORTED NOTHING, NEVER 0
1058     * (D55). A zero here would be indistinguishable from a genuinely zero-token
1059     * turn, and every total computed from the column downstream would be quietly
1060     * wrong in the cheap direction.
1061     */
1062    function persistTurn(
1063      runId: string,
1064      result: { entry: CouncilTranscriptEntry; record: TurnRecord }
1065    ): void {
1066      try {
1067        deps.storage.appendCouncilMessage({
1068          id: randomUUID(),
1069          runId,
1070          memberId: result.entry.memberId,
1071          round: result.entry.round,
1072          phase: result.entry.phase,
1073          content: result.entry.content,
1074          tokensIn: result.record.usage?.tokensIn ?? null,
1075          tokensOut: result.record.usage?.tokensOut ?? null,
1076          createdAt: new Date().toISOString()
1077        })
1078      } catch (err) {
1079        // A transcript write must never take down a run that is already spending.
1080        logger.error({ err }, `[council] could not persist a turn for run ${runId}`)
1081      }
1082    }
1083  
1084    /** Every saved member, widened with the two rows assembly needs. Rows in,
1085     *  decisions out — the policy is all in `assembleRun`. */
1086    function loadCandidates(): AssemblyCandidate[] {
1087      return deps.storage.listCouncilMembers().map((member) => {
1088        const credential = deps.storage.getCredentialProfileById(member.credentialProfileId)
1089        const provider = credential ? deps.storage.getProviderConfigById(credential.providerId) : null
1090        return {
1091          member: {
1092            id: member.id,
1093            label: member.label,
1094            credentialProfileId: member.credentialProfileId,
1095            model: member.model,
1096            role: member.role,
1097            paramsJson: member.paramsJson
1098          },
1099          provider: provider
1100            ? { id: provider.id, name: provider.name, authMode: provider.authMode, model: provider.model }
1101            : null,
1102          credential: credential
1103            ? {
1104                id: credential.id,
1105                providerId: credential.providerId,
1106                label: credential.label,
1107                unavailableSince: credential.unavailableSince
1108              }
1109            : null,
1110          baseUrl: provider?.baseUrl ?? null
1111        }
1112      })
1113    }
1114  
1115    /** `max_tokens` from `params_json`, clamped. A member that asks for a million
1116     *  gets the ceiling, not a 402 — the pre-authorization refuses the whole
1117     *  request, so an out-of-range parameter would take the run down rather than
1118     *  degrade it. */
1119    function resolveMaxOutputTokens(member: PlannedMember): number {
1120      const raw = member.params.max_tokens
1121      if (typeof raw !== 'number' || !Number.isFinite(raw)) return MAX_OUTPUT_TOKENS_DEFAULT
1122      return Math.min(MAX_OUTPUT_TOKENS_CEILING, Math.max(MAX_OUTPUT_TOKENS_FLOOR, Math.floor(raw)))
1123    }
1124  
1125    /* ---------------------------------------------------------------- */
1126  
1127    return {
1128      start,
1129  
1130      cancel(runId: string): boolean {
1131        const target = live.get(runId)
1132        if (!target) return false
1133        target.cancelled = true
1134        // The session-scoped signal aborts every in-flight member at once; each
1135        // member's own `finally` still calls dispose(), which is the sole
1136        // cancellation mechanism (D63 Q3) and the only thing that clears the
1137        // deadline timer.
1138        target.controller.abort()
1139        logger.info(`[council] run ${runId} cancelled by the user`)
1140        return true
1141      },
1142  
1143      abandonOpenRunsOnQuit(): void {
1144        for (const target of live.values()) {
1145          target.cancelled = true
1146          target.controller.abort()
1147          try {
1148            // Status only. `revoked_at` is deliberately NOT written: nothing here
1149            // can revoke, and a revocation timestamp for a key that still exists
1150            // would tell the boot reconcile to leave it alone.
1151            deps.storage.updateCouncilRun(target.runId, {
1152              status: COUNCIL_RUN_ABANDONED,
1153              endedAt: new Date().toISOString()
1154            })
1155          } catch {
1156            // Quitting. The ledger row is already open; that is the backstop.
1157          }
1158          logger.warn(`[council] run ${target.runId} abandoned at quit; its key is left to the boot reconcile`)
1159        }
1160        live.clear()
1161      }
1162    }
1163  }
1164  
```

### Exhibit 3 — `src/renderer/src/views/CouncilView.vue` (lines 1–1584, 55532 bytes)

```vue
   1  <script setup lang="ts">
   2  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
   3  import { useCouncilStore } from '../stores/council'
   4  import StateMarker from '../components/StateMarker.vue'
   5  
   6  /**
   7   * Council view (Task 3b-4 / D64(1)): brief `.md` in, deliberation on screen,
   8   * findings `.md` out beside the brief. A VIEW/ROUTE on the `SettingsView`
   9   * precedent, deliberately NOT a layout pane — D45(3)'s versioned layout-schema
  10   * change stays entirely out of this phase.
  11   *
  12   * Three rendering rules here are not styling (spec §4):
  13   *  1. every byte of the live deliberation arrived through main's ONE scrub seam
  14   *     (`SessionOutput.onText`); this component is given no other channel;
  15   *  2. a partial run READS as partial — the roster says who could not take part
  16   *     and the accounting says how many actually answered;
  17   *  3. findings are presented as DELIBERATION, not as verification. CR-3b.0's
  18   *     four compile errors are the standing evidence for why.
  19   */
  20  const props = defineProps<{ overlayOpen: boolean; projectId: string | null }>()
  21  const emit = defineEmits<{ close: [] }>()
  22  
  23  const council = useCouncilStore()
  24  
  25  /**
  26   * ⚠ THE ONLY SENTENCE THIS FEATURE MAY SHIP ABOUT REDACTION (F27, and
  27   * `Task-3b-4.md` quotes it verbatim). It is bounded on purpose: the pre-pass
  28   * matches KNOWN SHAPES from `secret-patterns.json` and cannot recognise a
  29   * credential that looks like prose. "Your brief is safe" is the claim this
  30   * wording exists to refuse.
  31   */
  32  const REDACTION_WORDING =
  33    'Chorus redacts registered exact values on ingest and scans briefs for known credential shapes. ' +
  34    'It cannot redact values an agent derives, and it cannot recognize a secret it has no pattern for.'
  35  
  36  // F13 (de98679): the view can unmount while the roster load is in flight. The
  37  // flag is set BEFORE the first await and checked after it; the Esc listener and
  38  // the progress subscription get the same discipline — registered on mount,
  39  // released on unmount, never leaked.
  40  let alive = true
  41  onMounted(async () => {
  42    window.addEventListener('keydown', onKeydown)
  43    council.subscribe()
  44    await council.loadMembers()
  45    if (!alive) return
  46  })
  47  onBeforeUnmount(() => {
  48    alive = false
  49    window.removeEventListener('keydown', onKeydown)
  50    council.unsubscribe()
  51    // The stored transcript is dropped with the view (spec §3): a re-entry reads
  52    // it again rather than showing rows from a run the user has moved past.
  53    council.clearTranscript()
  54    // The copy button's "copied" reset would otherwise fire into a dead
  55    // component — the same discipline the listener above gets.
  56    if (copyTimer !== null) clearTimeout(copyTimer)
  57    if (copyFindingsTimer !== null) clearTimeout(copyFindingsTimer)
  58  })
  59  
  60  function onKeydown(e: KeyboardEvent): void {
  61    if (e.key !== 'Escape') return
  62    // An overlay above the view owns Esc first (the SettingsView rule). A run in
  63    // flight also owns it: leaving mid-deliberation would strand a paid-for run
  64    // with nowhere to render.
  65    if (props.overlayOpen || council.running) return
  66    emit('close')
  67  }
  68  
  69  const briefName = computed<string>(() => {
  70    const path = council.briefPath
  71    if (!path) return ''
  72    const parts = path.split(/[\\/]/)
  73    return parts[parts.length - 1] ?? path
  74  })
  75  
  76  const canRun = computed<boolean>(
  77    () => !council.running && council.briefPath !== null && council.deliberators.length >= 2 && council.arbiters.length === 1
  78  )
  79  
  80  const labelFor = (memberId: string | null): string => {
  81    if (memberId === null) return 'orchestrator'
  82    return council.members.find((m) => m.id === memberId)?.label ?? memberId
  83  }
  84  
  85  const PHASE_LABEL: Record<string, string> = {
  86    positions: 'Positions (blind)',
  87    critique: 'Critique (anonymised)',
  88    arbitration: 'Arbitration',
  89    synthesis: 'Synthesis',
  90    done: 'Done'
  91  }
  92  
  93  /* ------------------------------------------------------------------ */
  94  /* The findings / transcript toggle — D97, Task 3e-4                   */
  95  /* ------------------------------------------------------------------ */
  96  
  97  /**
  98   * Which pane of the findings panel is showing. **Local, not store state**: it is
  99   * a fact about this component's presentation, and the store's business is what
 100   * came back from main.
 101   *
 102   * ⚠ SWITCHING PANES MUST NOT MOVE THE STANDING CAVEAT OUT OF VIEW (Task-3c-5
 103   * invariant 2, still binding). The caveat is rendered ABOVE the toggle's output
 104   * and outside it, so no value of this ref can hide it.
 105   */
 106  const findingsPane = ref<'findings' | 'transcript'>('findings')
 107  
 108  /** The mock's own denominator treatment: `transcript · 13 turns`, never a bare
 109   *  count (D55). Before a read, the number is the live block count — the only
 110   *  turn count this side legitimately knows — and after one it is main's
 111   *  `total_turns`, which is authoritative for what is STORED. */
 112  const transcriptCount = computed<number>(() =>
 113    council.transcript === null ? council.messages.length : council.transcriptTotal
 114  )
 115  
 116  /**
 117   * Show the stored transcript, reading it on first switch.
 118   *
 119   * ⚠ IT READS ONLY WHEN THERE IS A RUN ID TO READ. Without one there is nothing
 120   * to ask for, and inventing a fallback (e.g. "the most recent run") would show
 121   * the user a deliberation that is not the one on screen.
 122   */
 123  async function showTranscript(): Promise<void> {
 124    findingsPane.value = 'transcript'
 125    if (council.runId === null) return
 126    if (council.transcript !== null || council.transcriptLoading) return
 127    await council.loadTranscript(council.runId)
 128  }
 129  
 130  /**
 131   * The five-stop phase track (3c-5, ImplementationSpec §1a). Discrete stops with
 132   * a round counter, NOT a progress bar — the mock's own sample transcript argues
 133   * the reason and it is worth keeping: a bar implies a rate that cannot honestly
 134   * be estimated over a ~14-minute run.
 135   *
 136   * The qualifier under each stop is the mock's; the long PHASE_LABEL above stays
 137   * the transcript's vocabulary so the two surfaces do not disagree.
 138   */
 139  const PHASE_STOPS = [
 140    { key: 'positions', num: '01', label: 'Positions', qualifier: 'blind', flex: 1.2 },
 141    { key: 'critique', num: '02', label: 'Critique', qualifier: 'anonymised', flex: 1.2 },
 142    { key: 'arbitration', num: '03', label: 'Arbitration', qualifier: null, flex: 1 },
 143    { key: 'synthesis', num: '04', label: 'Synthesis', qualifier: null, flex: 1 },
 144    { key: 'done', num: '05', label: 'Done', qualifier: null, flex: 0.62 }
 145  ] as const
 146  
 147  /** -1 before a run starts, so every stop reads pending. */
 148  const phaseIndex = computed<number>(() =>
 149    council.phase === null ? -1 : PHASE_STOPS.findIndex((s) => s.key === council.phase)
 150  )
 151  
 152  function stopState(i: number): 'done' | 'active' | 'pending' {
 153    if (phaseIndex.value < 0) return 'pending'
 154    if (i < phaseIndex.value) return 'done'
 155    return i === phaseIndex.value ? 'active' : 'pending'
 156  }
 157  
 158  /**
 159   * ⚠ D76, AND THIS IS THE PLACE IT BINDS HARDEST IN THIS TASK. The mock's phase
 160   * header also renders `elapsed 4:38`, `est. remaining ~9m`, `round 1 of 2` and
 161   * `$0.31 so far`. NONE of the four has a source:
 162   *   - the store carries no run start time, and adding one is store logic, which
 163   *     this task may not touch;
 164   *   - an estimate is the dishonest number the five-stop track exists to refuse;
 165   *   - the renderer is never told how many rounds are planned, only which round
 166   *     it is in — so "of 2" would be invented;
 167   *   - `costUsd` arrives with the accounting at the END of a run, so there is no
 168   *     "so far" figure to show while one is in flight.
 169   * What ships is the round ordinal alone, and only once a run has reported one.
 170   * Render what the data supports; omit the rest; never a placeholder.
 171   */
 172  const roundLabel = computed<string | null>(() =>
 173    council.round === null ? null : `round ${council.round}`
 174  )
 175  
 176  /**
 177   * Per-member roster state during a run. Honest by construction: "answering"
 178   * means this member has produced output in the CURRENT phase and round, which
 179   * is exactly what the roster is reporting. The store carries no turn-closed
 180   * signal, so nothing here claims a turn finished.
 181   *
 182   * ⚠ 'queued' is NOT a StateMarker state and must not become one. StateMarker's
 183   * four geometries are the SESSION vocabulary (D77/D78); a waiting council turn
 184   * is a different kind of thing, and adding a fifth shape there would change a
 185   * contract the workspace depends on. It renders as the mock's own hollow ring,
 186   * defined locally below.
 187   */
 188  function memberState(memberId: string): 'error' | 'running' | 'done' | 'queued' {
 189    const m = council.members.find((x) => x.id === memberId)
 190    if (m && !m.available) return 'error'
 191    if (council.phase === null) return 'queued'
 192    const spoke = council.messages.some(
 193      (msg) => msg.memberId === memberId && msg.phase === council.phase && msg.round === council.round
 194    )
 195    if (!council.running) return spoke || council.findings !== null ? 'done' : 'queued'
 196    return spoke ? 'running' : 'queued'
 197  }
 198  
 199  /**
 200   * The same state narrowed to what `StateMarker` accepts, or null for 'queued'.
 201   * Kept as its own function rather than a cast in the template: the null is the
 202   * point — it is what says "this state has no marker" out loud, instead of a
 203   * cast quietly asserting that 'queued' can never arrive.
 204   */
 205  /**
 206   * Copy the whole transcript out as plain text, so a deliberation that cost real
 207   * money can be pasted into an issue, a doc, or another agent's context.
 208   *
 209   * ⚠ IT SERIALISES WHAT IS ON SCREEN AND NOTHING MORE. The text has already been
 210   * through main's ONE scrub seam (`SessionOutput.onText`) on its way here — this
 211   * component is given no other channel — so copying cannot reach around the
 212   * redaction. It must stay that way: sourcing this from anywhere but
 213   * `council.messages` would be a second, unscrubbed path to the same content.
 214   */
 215  type CopyState = 'idle' | 'copied' | 'failed'
 216  const copyState = ref<CopyState>('idle')
 217  const copyFindingsState = ref<CopyState>('idle')
 218  let copyTimer: ReturnType<typeof setTimeout> | null = null
 219  let copyFindingsTimer: ReturnType<typeof setTimeout> | null = null
 220  
 221  /** The label a copy button shows for a given state. One place, so the two
 222   *  buttons cannot drift into saying different things about the same outcome. */
 223  function copyLabel(state: CopyState): string {
 224    return state === 'copied' ? 'copied' : state === 'failed' ? 'copy failed' : 'copy'
 225  }
 226  
 227  function transcriptText(): string {
 228    // ⚠ THE TURN HEADER IS A RULE, NOT A MARKDOWN HEADING, AND THAT IS
 229    // DELIBERATE. Members write markdown, and a measured run's turns contained
 230    // 24 of their own `##` headings — so `## CR GLM (5.2)` would be
 231    // indistinguishable from a heading the model wrote, and the turn boundaries
 232    // would dissolve the moment the text was pasted anywhere.
 233    return council.messages
 234      .map((m) => {
 235        const head = `${labelFor(m.memberId)} · ${PHASE_LABEL[m.phase] ?? m.phase} · round ${m.round}`
 236        return `───── ${head} ─────\n\n${m.text}`
 237      })
 238      .join('\n\n')
 239  }
 240  
 241  async function copyTranscript(): Promise<void> {
 242    if (copyTimer !== null) clearTimeout(copyTimer)
 243    try {
 244      await navigator.clipboard.writeText(transcriptText())
 245      copyState.value = 'copied'
 246    } catch {
 247      // ⚠ Reported, never silent. A copy button that does nothing and says
 248      // nothing is worse than no copy button — the user walks away believing
 249      // they have the text.
 250      copyState.value = 'failed'
 251    }
 252    copyTimer = setTimeout(() => (copyState.value = 'idle'), 2000)
 253  }
 254  
 255  /**
 256   * Copy the findings document. Same rules as the transcript: it serialises what
 257   * is already on screen, which has been through main's one scrub seam.
 258   *
 259   * ⚠ IT COPIES THE DOCUMENT AS RENDERED, WHICH INCLUDES THE STANDING CAVEAT AND
 260   * ANY PARTIAL-RUN BANNER, because those are written INTO the document by
 261   * `councilCore` rather than added by this view. That matters: a findings
 262   * document pasted into an issue without its caveat is a set of model opinions
 263   * wearing the clothes of a verified result, which is exactly what the caveat
 264   * exists to prevent. Do not "clean up" the copied text.
 265   */
 266  async function copyFindings(): Promise<void> {
 267    if (copyFindingsTimer !== null) clearTimeout(copyFindingsTimer)
 268    try {
 269      await navigator.clipboard.writeText(council.findings ?? '')
 270      copyFindingsState.value = 'copied'
 271    } catch {
 272      copyFindingsState.value = 'failed'
 273    }
 274    copyFindingsTimer = setTimeout(() => (copyFindingsState.value = 'idle'), 2000)
 275  }
 276  
 277  function markerFor(memberId: string): 'error' | 'running' | 'done' | null {
 278    const state = memberState(memberId)
 279    return state === 'queued' ? null : state
 280  }
 281  
 282  /**
 283   * The roster's 2px spine, cycled by position. Four tokens exist and the mock
 284   * uses exactly these four, in this order, for its four roster cards.
 285   */
 286  const SPINES = [
 287    'var(--color-accent-periwinkle)',
 288    'var(--color-spine-blue)',
 289    'var(--color-spine-sand)',
 290    'var(--color-spine-violet)'
 291  ] as const
 292  
 293  function spineFor(i: number): string {
 294    return SPINES[i % SPINES.length]
 295  }
 296  </script>
 297  
 298  <template>
 299    <div class="flex h-full">
 300      <!-- roster -->
 301      <nav class="cn-rail">
 302        <div class="cn-rail-head">
 303          <span class="cn-eyebrow">COUNCIL</span>
 304          <span class="flex-1"></span>
 305          <span v-if="council.members.length > 0" class="cn-meta">
 306            {{ council.members.length }}
 307          </span>
 308        </div>
 309  
 310        <!-- ⚠ NO MEMBERS: the mock's own empty state — the dimmed chorus glyph
 311             over a sentence that says where to go. -->
 312        <div v-if="council.members.length === 0" class="cn-empty">
 313          <div class="cn-glyph">
 314            <span v-for="(h, i) in [9, 15, 21, 26, 21, 15, 9]" :key="i" :style="{ height: `${h}px` }" />
 315          </div>
 316          <p class="cn-empty-text">
 317            No council members are configured. Add some in Settings first.
 318          </p>
 319        </div>
 320  
 321        <div class="cn-roster">
 322          <div
 323            v-for="(m, i) in council.members"
 324            :key="m.id"
 325            class="cn-member"
 326            :class="{ 'cn-member-live': memberState(m.id) === 'running', 'cn-member-done': memberState(m.id) === 'done' }"
 327            :data-council-member-state="memberState(m.id)"
 328          >
 329            <div class="cn-spine" :style="{ background: spineFor(i) }"></div>
 330            <div class="flex items-center gap-2">
 331              <span class="cn-member-name truncate">{{ m.label }}</span>
 332              <span class="flex-1"></span>
 333              <!-- Per-member state is a STABLE marker, never a spinner: motion
 334                   lives in the phase track (ImplementationSpec-3c-5 §1a). -->
 335              <StateMarker v-if="markerFor(m.id)" :state="markerFor(m.id)!" />
 336              <span v-else class="cn-marker-queued"></span>
 337            </div>
 338            <div class="cn-member-sub">
 339              <span class="cn-role">{{ m.role }}</span>
 340              <span class="cn-member-model truncate">{{ m.resolvedModel ?? 'no model resolved' }}</span>
 341            </div>
 342            <!-- ⚠ A member that cannot deliberate is SHOWN AND EXPLAINED, never
 343                 quietly dropped: assembly refuses the whole run over it, and a
 344                 roster that hid it would make that refusal unreadable. -->
 345            <div v-if="!m.available" class="cn-member-refused">
 346              {{ m.unavailableReason ?? 'unavailable' }}
 347            </div>
 348          </div>
 349        </div>
 350  
 351        <!-- The roster legend: the marker vocabulary, readable without prior
 352             knowledge (ImplementationSpec-3c-5 §1a). -->
 353        <div v-if="council.members.length > 0" class="cn-legend">
 354          <span class="cn-legend-item"><span class="cn-marker-queued"></span>queued</span>
 355          <span class="cn-legend-item"><StateMarker state="running" />answering</span>
 356          <span class="cn-legend-item"><StateMarker state="done" />done</span>
 357          <span class="cn-legend-item"><StateMarker state="error" />refused</span>
 358        </div>
 359  
 360        <div v-if="council.members.length > 0" class="cn-roster-summary">
 361          {{ council.deliberators.length }} deliberator{{ council.deliberators.length === 1 ? '' : 's' }}
 362          · {{ council.arbiters.length }} arbiter{{ council.arbiters.length === 1 ? '' : 's' }}
 363        </div>
 364  
 365        <div class="flex-1"></div>
 366        <button class="cn-back" :disabled="council.running" @click="emit('close')">
 367          back to workspace
 368          <span class="flex-1"></span>
 369          <span class="cn-keycap">esc</span>
 370        </button>
 371      </nav>
 372  
 373      <!-- run surface -->
 374      <div class="cn-main">
 375        <h1 class="cn-title">Council review</h1>
 376        <p class="cn-lede">
 377          Point Chorus at a brief. Every member answers its numbered questions blind, critiques the
 378          others anonymised, and the arbiter rules and synthesizes. The findings land as a
 379          <code class="cn-code">-Findings.md</code> file beside the brief.
 380        </p>
 381  
 382        <!-- brief picker -->
 383        <div class="mt-4 flex items-center gap-3">
 384          <button
 385            class="cn-btn"
 386            :disabled="council.running"
 387            data-testid="council-choose-brief"
 388            @click="council.pickBrief()"
 389          >
 390            Choose brief…
 391          </button>
 392          <span v-if="briefName" class="cn-brief" :title="council.briefPath ?? ''">{{ briefName }}</span>
 393          <span v-else class="cn-meta">no brief chosen</span>
 394  
 395          <span class="flex-1"></span>
 396  
 397          <button
 398            v-if="council.running"
 399            class="cn-btn"
 400            :disabled="council.runId === null"
 401            @click="council.cancel()"
 402          >
 403            Cancel run
 404          </button>
 405          <button
 406            v-else
 407            class="cn-btn cn-btn-primary"
 408            :disabled="!canRun"
 409            data-testid="council-run"
 410            @click="council.run(props.projectId)"
 411          >
 412            Run council
 413          </button>
 414        </div>
 415  
 416        <!-- ⚠ F27, verbatim and unabridged. This is the first surface a user reads
 417             a redaction claim on, and the claim is deliberately bounded. -->
 418        <p class="cn-redaction">{{ REDACTION_WORDING }}</p>
 419  
 420        <p v-if="council.error" class="cn-error">{{ council.error }}</p>
 421  
 422        <!-- ══ the five-stop phase track ══
 423             Rendered once a run has reported a phase. Discrete stops, an explicit
 424             round ordinal, and NO progress bar — see PHASE_STOPS above. -->
 425        <div v-if="council.phase !== null" class="cn-phases" data-council-phase-track>
 426          <div class="flex items-center gap-2.5">
 427            <span class="cn-eyebrow">PHASE</span>
 428            <span v-if="roundLabel" class="cn-meta cn-meta-bright">{{ roundLabel }}</span>
 429            <span class="cn-meta">{{ PHASE_LABEL[council.phase] ?? council.phase }}</span>
 430          </div>
 431          <div class="cn-track">
 432            <div
 433              v-for="(stop, i) in PHASE_STOPS"
 434              :key="stop.key"
 435              class="cn-stop"
 436              :style="{ flex: stop.flex }"
 437              :data-council-stop="stop.key"
 438              :data-council-stop-state="stopState(i)"
 439            >
 440              <div class="cn-stop-bar" :class="`cn-stop-bar-${stopState(i)}`" data-slide></div>
 441              <div class="flex items-center gap-1.5">
 442                <span class="cn-stop-num" :class="`cn-stop-${stopState(i)}`">{{ stop.num }}</span>
 443                <span class="cn-stop-label" :class="`cn-stop-${stopState(i)}`">
 444                  {{ stop.label }}
 445                  <span v-if="stop.qualifier" class="cn-stop-qualifier">{{ stop.qualifier }}</span>
 446                </span>
 447                <span class="flex-1"></span>
 448                <span v-if="stopState(i) === 'done'" class="cn-stop-status">done</span>
 449              </div>
 450            </div>
 451          </div>
 452        </div>
 453  
 454        <!-- live deliberation -->
 455        <!-- Same anatomy as the findings panel below: a bordered panel with a
 456             header bar, and ONE scrolling well inside it. The turns are flat
 457             blocks in that well rather than bordered cards, because a card
 458             inside a well inside a panel is three nested boxes and reads as a
 459             window inside a window. -->
 460        <section v-if="council.messages.length > 0" class="cn-panel cn-panel-static mt-5">
 461          <div class="cn-panel-head">
 462            <span class="cn-eyebrow">TRANSCRIPT</span>
 463            <span class="cn-meta">
 464              {{ council.messages.length }} turn{{ council.messages.length === 1 ? '' : 's' }} so far
 465            </span>
 466            <span class="flex-1"></span>
 467            <!-- Copy the whole transcript out. Sits at the TOP of the list rather
 468                 than the bottom because the list scrolls: a control below a
 469                 scroll region is a control you have to scroll to reach. -->
 470            <button
 471              class="cn-copy"
 472              :title="copyState === 'copied' ? 'copied' : 'copy the transcript'"
 473              data-council-copy
 474              @click="copyTranscript"
 475            >
 476              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2">
 477                <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" />
 478                <path d="M9.5 2.5h-6a2 2 0 0 0-2 2v6" />
 479              </svg>
 480              {{ copyLabel(copyState) }}
 481            </button>
 482          </div>
 483          <!-- ⚠ HEIGHT-RESTRICTED AND SCROLLABLE ON PURPOSE. A run produces
 484               thirteen turns of full model output; left to grow, the transcript
 485               pushes the findings and accounting panels off the bottom of the
 486               window, and those are the two things a finished run is read FOR.
 487               The transcript scrolls inside its own well so all three stay on
 488               screen at once. -->
 489          <div class="cn-panel-body">
 490            <div class="cn-transcript">
 491            <article v-for="(msg, i) in council.messages" :key="i" class="cn-turn">
 492              <div class="cn-turn-head">
 493                <span class="cn-turn-who">{{ labelFor(msg.memberId) }}</span>
 494                <span class="cn-turn-meta">
 495                  {{ PHASE_LABEL[msg.phase] ?? msg.phase }} · round {{ msg.round }}
 496                </span>
 497              </div>
 498              <pre class="cn-turn-body">{{ msg.text }}</pre>
 499            </article>
 500  
 501            <!-- ⚠ REFUSED TURNS ARE ROWS, NOT GAPS (Task-3c-5 invariant 3, as the
 502                 mock extends it). A member that is unavailable contributed
 503                 nothing to this run and says so here as well as in the roster —
 504                 a council that quietly shrinks cannot be audited afterwards. -->
 505            <div
 506              v-for="m in council.unavailable"
 507              :key="`refused-${m.id}`"
 508              class="cn-turn cn-turn-refused"
 509              data-council-refused-row
 510            >
 511              <div class="cn-turn-head">
 512                <span class="cn-turn-who">{{ m.label }}</span>
 513                <span class="cn-turn-refused-tag">refused · no output</span>
 514              </div>
 515              <div class="cn-turn-refused-why">
 516                {{ m.unavailableReason ?? 'unavailable' }} · this member contributed nothing and is
 517                counted as refused, not answered
 518              </div>
 519            </div>
 520  
 521            <!-- next-up placeholder, so a waiting round reads as waiting rather
 522                 than as finished. -->
 523            <div v-if="council.running" class="cn-nextup" data-council-nextup>
 524              <span class="cn-marker-queued"></span>
 525              <span class="flex-1">waiting for the rest of this round to close</span>
 526              <span class="cn-stop-status">queued</span>
 527            </div>
 528            </div>
 529          </div>
 530        </section>
 531  
 532        <!-- findings -->
 533        <section v-if="council.findings" class="cn-result">
 534          <!-- findings document -->
 535          <div class="cn-panel min-w-0 flex-1">
 536            <div class="cn-panel-head">
 537              <span class="cn-eyebrow">FINDINGS</span>
 538              <!-- ⚠ THE MOCK ALREADY DRAWS THIS (D97): a two-segment control
 539                   beside the eyebrow, the inactive segment quieter, and the count
 540                   carrying its noun. `council_messages` has been written on every
 541                   run since 3b-3 and read by nothing; this is its door. -->
 542              <span class="cn-seg" data-council-pane-toggle>
 543                <button
 544                  class="cn-seg-btn"
 545                  :class="{ 'cn-seg-on': findingsPane === 'findings' }"
 546                  data-council-pane-findings
 547                  @click="findingsPane = 'findings'"
 548                >
 549                  findings
 550                </button>
 551                <button
 552                  class="cn-seg-btn"
 553                  :class="{ 'cn-seg-on': findingsPane === 'transcript' }"
 554                  data-council-pane-transcript
 555                  @click="showTranscript"
 556                >
 557                  transcript · {{ transcriptCount }} turn{{ transcriptCount === 1 ? '' : 's' }}
 558                </button>
 559              </span>
 560              <span class="flex-1"></span>
 561              <span v-if="council.findingsPath" class="cn-meta truncate" :title="council.findingsPath">
 562                written beside the brief
 563              </span>
 564            </div>
 565            <div class="cn-panel-body">
 566              <!-- ⚠ SPEC §4.3 / §3.2: presented as DELIBERATION, not as
 567                   verification, and this caveat sits ABOVE the synthesis,
 568                   unconditionally and undismissibly. CR-3b.0 produced sound
 569                   rulings containing four compile errors; this is the mechanism
 570                   that keeps that visible. -->
 571              <p class="cn-caveat">
 572                These findings are model deliberation, not verified fact. Nothing here was compiled, run or
 573                tested, and no member could see the repository.
 574              </p>
 575  
 576              <!-- The written-to line doubles as the findings' action row: the
 577                   copy button sits on it rather than on its own, so the document
 578                   gains an affordance without gaining a bar. -->
 579              <template v-if="findingsPane === 'findings'">
 580                <div class="mt-2 flex items-start gap-3">
 581                  <p v-if="council.findingsPath" class="cn-meta min-w-0 flex-1 break-all">
 582                    Written to <span class="cn-meta-bright">{{ council.findingsPath }}</span>
 583                  </p>
 584                  <p v-else-if="council.findingsError" class="cn-error min-w-0 flex-1">
 585                    {{ council.findingsError }}
 586                  </p>
 587                  <span v-else class="flex-1"></span>
 588                  <button
 589                    class="cn-copy"
 590                    :title="copyFindingsState === 'copied' ? 'copied' : 'copy the findings'"
 591                    data-council-copy-findings
 592                    @click="copyFindings"
 593                  >
 594                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2">
 595                      <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" />
 596                      <path d="M9.5 2.5h-6a2 2 0 0 0-2 2v6" />
 597                    </svg>
 598                    {{ copyLabel(copyFindingsState) }}
 599                  </button>
 600                </div>
 601  
 602                <pre class="cn-findings">{{ council.findings }}</pre>
 603              </template>
 604  
 605              <!-- The STORED transcript (D97). Same `.cn-turn` treatment as the
 606                   live panel above, so one vocabulary describes both — a turn is a
 607                   turn whether it is arriving or being re-read. -->
 608              <template v-else>
 609                <div class="mt-2 flex items-start gap-3">
 610                  <p class="cn-meta min-w-0 flex-1">
 611                    <template v-if="council.transcriptLoading">reading the stored transcript…</template>
 612                    <template v-else-if="council.transcriptError" />
 613                    <template v-else-if="council.runId === null">
 614                      No run id on this side, so there is nothing to read back.
 615                    </template>
 616                    <template v-else>
 617                      <span class="cn-meta-bright">{{ council.transcript?.length ?? 0 }}</span>
 618                      of {{ council.transcriptTotal }} stored turn{{ council.transcriptTotal === 1 ? '' : 's' }},
 619                      read from this run's own record
 620                    </template>
 621                  </p>
 622                </div>
 623                <p v-if="council.transcriptError" class="cn-error mt-2">
 624                  {{ council.transcriptError }}
 625                </p>
 626                <!-- ⚠ TRUNCATION IS RENDERED, NEVER SWALLOWED. A partial read that
 627                     does not say it is partial is worse than no reader. -->
 628                <p v-if="council.transcriptTruncated" class="cn-caveat mt-2">
 629                  This read hit its size cap, so the turns below stop short of the whole record. The
 630                  full transcript is still in the database.
 631                </p>
 632                <div class="cn-findings cn-stored-transcript">
 633                  <article
 634                    v-for="(t, i) in council.transcript ?? []"
 635                    :key="`stored-${i}`"
 636                    class="cn-turn"
 637                    data-council-stored-turn
 638                  >
 639                    <div class="cn-turn-head">
 640                      <span class="cn-turn-who">{{ labelFor(t.member_id) }}</span>
 641                      <span class="cn-turn-meta">
 642                        {{ PHASE_LABEL[t.phase] ?? t.phase }} · round {{ t.round }}
 643                      </span>
 644                    </div>
 645                    <pre class="cn-turn-body">{{ t.text }}</pre>
 646                  </article>
 647                  <p
 648                    v-if="!council.transcriptLoading && (council.transcript?.length ?? 0) === 0"
 649                    class="cn-meta"
 650                  >
 651                    This run stored no transcript rows.
 652                  </p>
 653                </div>
 654              </template>
 655            </div>
 656          </div>
 657  
 658          <!-- ⚠ D55 ONE LAYER UP: no number without its denominator. A cost or a
 659               token count rendered alone is the same defect the schema already
 660               forbids on the wire. -->
 661          <div v-if="council.accounting" class="cn-panel cn-accounting">
 662            <div class="cn-panel-head">
 663              <span class="cn-eyebrow">ACCOUNTING</span>
 664              <span class="flex-1"></span>
 665              <span class="cn-denominator-note">every figure carries its denominator</span>
 666            </div>
 667            <div class="cn-acct-body">
 668              <div class="cn-acct-group">
 669                <span class="cn-acct-label">MEMBERS</span>
 670                <span class="cn-acct-figure">
 671                  {{ council.accounting.membersAnswered }} answered
 672                  <span class="cn-acct-of">of</span> {{ council.accounting.membersPlanned }} planned
 673                </span>
 674                <span v-if="council.accounting.membersRefused > 0" class="cn-acct-sub cn-acct-sub-bad">
 675                  {{ council.accounting.membersRefused }} refused at least once
 676                </span>
 677              </div>
 678  
 679              <div class="cn-acct-rule"></div>
 680  
 681              <div class="cn-acct-group">
 682                <span class="cn-acct-label">TURNS</span>
 683                <span class="cn-acct-figure">
 684                  {{ council.accounting.turnsAnswered }} answered
 685                  <span class="cn-acct-of">·</span> {{ council.accounting.turnsRefused }} refused
 686                </span>
 687                <span class="cn-acct-sub">
 688                  {{ council.accounting.turnsAnswered + council.accounting.turnsRefused }} attempted in
 689                  total
 690                </span>
 691              </div>
 692  
 693              <div class="cn-acct-rule"></div>
 694  
 695              <div class="cn-acct-group">
 696                <span class="cn-acct-label">USAGE COVERAGE</span>
 697                <span class="cn-acct-figure">
 698                  reported for {{ council.accounting.usageReported }}
 699                  <span class="cn-acct-of">of</span>
 700                  {{ council.accounting.usageReported + council.accounting.usageAbsent }} turns
 701                </span>
 702                <span class="cn-acct-sub">
 703                  absent for {{ council.accounting.usageAbsent }} of
 704                  {{ council.accounting.usageReported + council.accounting.usageAbsent }} turns
 705                </span>
 706                <div class="cn-coverage">
 707                  <span
 708                    class="cn-coverage-on"
 709                    :style="{ flex: council.accounting.usageReported || 0.0001 }"
 710                  ></span>
 711                  <span
 712                    v-if="council.accounting.usageAbsent > 0"
 713                    class="cn-coverage-off"
 714                    :style="{ flex: council.accounting.usageAbsent }"
 715                  ></span>
 716                </div>
 717              </div>
 718  
 719              <div class="cn-acct-rule"></div>
 720  
 721              <div class="cn-acct-group">
 722                <span class="cn-acct-label">TOKENS</span>
 723                <span class="cn-acct-figure">
 724                  <template
 725                    v-if="council.accounting.tokensIn === null && council.accounting.tokensOut === null"
 726                  >
 727                    not reported
 728                  </template>
 729                  <template v-else>
 730                    {{ council.accounting.tokensIn ?? 'n/r' }} in
 731                    <span class="cn-acct-of">·</span> {{ council.accounting.tokensOut ?? 'n/r' }} out
 732                  </template>
 733                </span>
 734                <span class="cn-acct-sub">
 735                  covers the {{ council.accounting.usageReported }} of
 736                  {{ council.accounting.usageReported + council.accounting.usageAbsent }} turns that
 737                  reported usage
 738                </span>
 739              </div>
 740  
 741              <div class="cn-acct-rule"></div>
 742  
 743              <div class="cn-acct-group">
 744                <span class="cn-acct-label">COST</span>
 745                <span class="cn-acct-cost">
 746                  <template v-if="council.costUsd === null">not reported</template>
 747                  <template v-else>${{ council.costUsd }}</template>
 748                </span>
 749                <!-- ⚠ F39 MADE VISIBLE, and the clause is CONDITIONAL because it
 750                     is a fact, not a disclaimer: when every turn reported usage
 751                     the figure IS the total, and saying otherwise would be its
 752                     own dishonesty. -->
 753                <span class="cn-acct-sub">
 754                  covers {{ council.accounting.usageReported }} of
 755                  {{ council.accounting.usageReported + council.accounting.usageAbsent }} turns<template
 756                    v-if="council.accounting.usageAbsent > 0"
 757                  >
 758                    · {{ council.accounting.usageAbsent }}
 759                    turn{{ council.accounting.usageAbsent === 1 ? '' : 's' }}
 760                    <span class="cn-acct-sub-bright">not reported by the provider</span> · true total is
 761                    at least this</template
 762                  >
 763                </span>
 764              </div>
 765            </div>
 766          </div>
 767        </section>
 768      </div>
 769    </div>
 770  </template>
 771  
 772  <style scoped>
 773  /* ═══════════════════════════════════════════════════════════════════════════
 774     Council view — Task 3c-5, against docs/design/v2/Chorus Council.dc.html.
 775  
 776     Every value is a 3c-1 token. The three the council mock introduced
 777     (--color-spine-blue, --color-glyph-dim-mid, --color-glyph-dim-high) were
 778     already added by 3c-1 ahead of this task, per ImplementationSpec-3c-5 §1b.
 779     ═══════════════════════════════════════════════════════════════════════════ */
 780  
 781  /* ── Roster rail ─────────────────────────────────────────────────────────
 782     208px, same width and surface as the project rail and the settings nav —
 783     the mock draws one rail in three contexts, not three rails. */
 784  .cn-rail {
 785    width: 208px;
 786    flex: none;
 787    display: flex;
 788    flex-direction: column;
 789    overflow-y: auto;
 790    background: var(--color-surface-rail);
 791    border-right: 1px solid var(--color-border-chrome);
 792    padding: 10px 8px 8px;
 793  }
 794  
 795  .cn-rail-head {
 796    display: flex;
 797    align-items: center;
 798    padding: 0 4px 8px;
 799  }
 800  
 801  .cn-eyebrow {
 802    flex: none;
 803    font-family: var(--font-mono);
 804    font-size: 9.5px;
 805    letter-spacing: 0.18em;
 806    color: var(--color-text-eyebrow);
 807    user-select: none;
 808  }
 809  
 810  .cn-meta {
 811    font-family: var(--font-mono);
 812    font-size: 10px;
 813    color: var(--color-text-quiet);
 814  }
 815  
 816  .cn-meta-bright {
 817    color: var(--color-text-muted);
 818  }
 819  
 820  /* ── "no members configured" — the mock's own empty state ───────────────── */
 821  .cn-empty {
 822    display: flex;
 823    flex-direction: column;
 824    align-items: center;
 825    gap: 12px;
 826    padding: 28px 8px;
 827  }
 828  
 829  /* The chorus mark at rest, in the dimmed tones the mock uses for it. The
 830     centre bar keeps the jade so the glyph is still recognisably the app's. */
 831  .cn-glyph {
 832    display: flex;
 833    align-items: center;
 834    gap: 3px;
 835    opacity: 0.5;
 836  }
 837  
 838  .cn-glyph span {
 839    width: 3px;
 840    border-radius: var(--radius-bar);
 841    background: var(--color-glyph-dim-high);
 842  }
 843  
 844  .cn-glyph span:nth-child(1),
 845  .cn-glyph span:nth-child(7) {
 846    background: var(--color-glyph-dim-low);
 847  }
 848  
 849  .cn-glyph span:nth-child(2),
 850  .cn-glyph span:nth-child(6) {
 851    background: var(--color-glyph-dim-mid);
 852  }
 853  
 854  .cn-glyph span:nth-child(4) {
 855    background: var(--color-accent-jade);
 856  }
 857  
 858  .cn-empty-text {
 859    font-size: 11.5px;
 860    line-height: 1.5;
 861    text-align: center;
 862    color: var(--color-text-quiet);
 863  }
 864  
 865  /* ── Member cards ────────────────────────────────────────────────────────
 866     Left padding is 14px, not 10px: the 2px spine sits in that gutter. */
 867  .cn-roster {
 868    display: flex;
 869    flex-direction: column;
 870    gap: 5px;
 871  }
 872  
 873  .cn-member {
 874    position: relative;
 875    background: var(--color-surface-card);
 876    border: 1px solid var(--color-border-inset);
 877    border-radius: var(--radius-rail);
 878    padding: 9px 10px 9px 14px;
 879  }
 880  
 881  /* A member currently producing output takes the running border; a member whose
 882     turn is behind it dims, exactly as the mock draws them. Neither animates —
 883     motion lives in the phase track. */
 884  .cn-member-live {
 885    background: var(--color-surface-card-hover);
 886    border-color: color-mix(in srgb, var(--color-state-running) 28%, transparent);
 887  }
 888  
 889  .cn-member-done {
 890    opacity: 0.82;
 891  }
 892  
 893  .cn-spine {
 894    position: absolute;
 895    left: 0;
 896    top: 8px;
 897    bottom: 8px;
 898    width: 2px;
 899    border-radius: 1px;
 900  }
 901  
 902  .cn-member-name {
 903    font-size: 12px;
 904    font-weight: 500;
 905    color: var(--color-text-primary);
 906  }
 907  
 908  .cn-member-sub {
 909    display: flex;
 910    align-items: center;
 911    gap: 6px;
 912    margin-top: 3px;
 913    min-width: 0;
 914  }
 915  
 916  .cn-role {
 917    flex: none;
 918    font-family: var(--font-mono);
 919    font-size: 9px;
 920    letter-spacing: 0.1em;
 921    text-transform: uppercase;
 922    color: var(--color-text-eyebrow);
 923  }
 924  
 925  .cn-member-model {
 926    font-family: var(--font-mono);
 927    font-size: 10px;
 928    color: var(--color-text-quiet);
 929  }
 930  
 931  .cn-member-refused {
 932    margin-top: 5px;
 933    font-family: var(--font-mono);
 934    font-size: 10px;
 935    line-height: 1.5;
 936    color: var(--color-state-error-text);
 937  }
 938  
 939  /* NOT a StateMarker state — see memberState()'s comment. The mock's hollow
 940     ring for a turn that has not begun. */
 941  .cn-marker-queued {
 942    width: 8px;
 943    height: 8px;
 944    flex: none;
 945    border-radius: 50%;
 946    border: 1.5px solid var(--color-text-eyebrow);
 947  }
 948  
 949  /* ── Legend ──────────────────────────────────────────────────────────────
 950     So the marker vocabulary is readable without prior knowledge. */
 951  .cn-legend {
 952    display: flex;
 953    flex-wrap: wrap;
 954    gap: 4px 10px;
 955    padding: 10px 4px 6px;
 956  }
 957  
 958  .cn-legend-item {
 959    display: flex;
 960    align-items: center;
 961    gap: 5px;
 962    font-family: var(--font-mono);
 963    font-size: 9px;
 964    color: var(--color-text-eyebrow);
 965  }
 966  
 967  .cn-roster-summary {
 968    padding: 4px 4px 0;
 969    font-family: var(--font-mono);
 970    font-size: 9.5px;
 971    line-height: 1.6;
 972    color: var(--color-text-eyebrow);
 973  }
 974  
 975  .cn-back {
 976    display: flex;
 977    align-items: center;
 978    gap: 8px;
 979    width: 100%;
 980    padding: 7px 6px;
 981    border: 0;
 982    background: transparent;
 983    font-size: 12px;
 984    color: var(--color-text-quiet);
 985    cursor: default;
 986  }
 987  
 988  .cn-back:hover:not(:disabled) {
 989    color: var(--color-text-secondary);
 990  }
 991  
 992  .cn-back:disabled {
 993    opacity: 0.4;
 994    cursor: not-allowed;
 995  }
 996  
 997  /* Matched to the status bar's and overlays.css's keycap, not re-derived. */
 998  .cn-keycap {
 999    flex: none;
1000    font-family: var(--font-mono);
1001    font-size: 9.5px;
1002    border: 1px solid var(--color-border-divider);
1003    background: var(--color-surface-keycap);
1004    border-radius: var(--radius-chip);
1005    padding: 1px 5px;
1006    color: var(--color-text-quiet);
1007  }
1008  
1009  /* ── Main column ───────────────────────────────────────────────────────── */
1010  .cn-main {
1011    flex: 1;
1012    min-width: 0;
1013    display: flex;
1014    flex-direction: column;
1015    overflow-y: auto;
1016    padding: 22px 32px;
1017  }
1018  
1019  .cn-title {
1020    flex: none;
1021    font-size: 16px;
1022    font-weight: 600;
1023    color: var(--color-text-primary);
1024  }
1025  
1026  .cn-lede {
1027    flex: none;
1028    max-width: 46rem;
1029    margin-top: 6px;
1030    font-size: 12px;
1031    line-height: 1.6;
1032    color: var(--color-text-secondary);
1033  }
1034  
1035  .cn-code {
1036    font-family: var(--font-mono);
1037    font-size: 11px;
1038    color: var(--color-text-body);
1039  }
1040  
1041  .cn-btn {
1042    flex: none;
1043    border: 1px solid var(--color-border-badge);
1044    background: var(--color-surface-field);
1045    border-radius: var(--radius-rail);
1046    padding: 6px 12px;
1047    font-size: 11.5px;
1048    color: var(--color-text-secondary);
1049    cursor: default;
1050  }
1051  
1052  .cn-btn:hover:not(:disabled) {
1053    border-color: var(--color-logo-bar-low);
1054    color: var(--color-text-body);
1055  }
1056  
1057  .cn-btn:disabled {
1058    opacity: 0.4;
1059    cursor: not-allowed;
1060  }
1061  
1062  .cn-btn-primary {
1063    border-color: color-mix(in srgb, var(--color-accent-jade) 40%, transparent);
1064    background: color-mix(in srgb, var(--color-accent-jade) 7%, transparent);
1065    color: var(--color-accent-jade);
1066  }
1067  
1068  .cn-btn-primary:hover:not(:disabled) {
1069    border-color: color-mix(in srgb, var(--color-accent-jade) 40%, transparent);
1070    background: color-mix(in srgb, var(--color-accent-jade) 14%, transparent);
1071    color: var(--color-accent-jade);
1072  }
1073  
1074  .cn-brief {
1075    min-width: 0;
1076    font-family: var(--font-mono);
1077    font-size: 11px;
1078    color: var(--color-text-body);
1079    overflow: hidden;
1080    text-overflow: ellipsis;
1081    white-space: nowrap;
1082  }
1083  
1084  /* F27's sentence. Quiet, but never small enough to be skipped. */
1085  .cn-redaction {
1086    flex: none;
1087    max-width: 46rem;
1088    margin-top: 12px;
1089    font-size: 11px;
1090    line-height: 1.6;
1091    color: var(--color-text-eyebrow);
1092  }
1093  
1094  .cn-error {
1095    flex: none;
1096    max-width: 46rem;
1097    margin-top: 14px;
1098    border: 1px solid color-mix(in srgb, var(--color-state-error) 35%, transparent);
1099    background: color-mix(in srgb, var(--color-state-error) 8%, transparent);
1100    border-radius: var(--radius-rail);
1101    padding: 8px 12px;
1102    font-size: 11.5px;
1103    color: var(--color-state-error-text);
1104  }
1105  
1106  /* ── The five-stop phase track ───────────────────────────────────────────── */
1107  .cn-phases {
1108    flex: none;
1109    margin-top: 18px;
1110    background: var(--color-surface-card);
1111    border: 1px solid var(--color-border-inset);
1112    border-radius: var(--radius-card);
1113    padding: 11px 14px 12px;
1114    display: flex;
1115    flex-direction: column;
1116    gap: 9px;
1117  }
1118  
1119  .cn-track {
1120    display: flex;
1121    align-items: stretch;
1122    gap: 6px;
1123  }
1124  
1125  .cn-stop {
1126    display: flex;
1127    flex-direction: column;
1128    gap: 6px;
1129    min-width: 0;
1130  }
1131  
1132  .cn-stop-bar {
1133    height: 4px;
1134    border-radius: var(--radius-bar);
1135  }
1136  
1137  .cn-stop-bar-pending {
1138    background: var(--color-border-inset);
1139  }
1140  
1141  .cn-stop-bar-done {
1142    background: color-mix(in srgb, var(--color-accent-jade) 55%, transparent);
1143  }
1144  
1145  /* ⚠ THE ONLY ANIMATION IN THIS VIEW, AND THAT IS THE DESIGN RULING. The mock
1146     puts the motion here rather than on four per-member spinners, because the
1147     user is waiting on the round, not on any single voice. The stripe travels
1148     22px, which is one full period of the gradient. */
1149  .cn-stop-bar-active {
1150    background-image: linear-gradient(
1151      100deg,
1152      var(--color-accent-jade) 0 11px,
1153      color-mix(in srgb, var(--color-accent-jade) 45%, transparent) 11px 22px
1154    );
1155    background-size: 22px 100%;
1156    animation: phaseSlide 1.1s linear infinite;
1157  }
1158  
1159  @keyframes phaseSlide {
1160    0% {
1161      background-position: 0 0;
1162    }
1163    100% {
1164      background-position: 22px 0;
1165    }
1166  }
1167  
1168  /* The reduced-motion resolution is the BRIGHT end held static, matching the
1169     rule 3c-1 wrote for chorusPulse: a user who cannot tolerate motion must not
1170     also lose the signal. */
1171  @media (prefers-reduced-motion: reduce) {
1172    .cn-stop-bar-active {
1173      animation: none;
1174      background-image: none;
1175      background-color: var(--color-accent-jade);
1176    }
1177  }
1178  
1179  .cn-stop-num {
1180    flex: none;
1181    font-family: var(--font-mono);
1182    font-size: 9.5px;
1183  }
1184  
1185  .cn-stop-label {
1186    min-width: 0;
1187    font-size: 11.5px;
1188    white-space: nowrap;
1189    overflow: hidden;
1190    text-overflow: ellipsis;
1191  }
1192  
1193  .cn-stop-pending {
1194    color: var(--color-text-eyebrow);
1195  }
1196  
1197  .cn-stop-done {
1198    color: var(--color-text-secondary);
1199  }
1200  
1201  .cn-stop-active {
1202    color: var(--color-text-primary);
1203    font-weight: 600;
1204  }
1205  
1206  .cn-stop-qualifier {
1207    font-family: var(--font-mono);
1208    font-size: 10px;
1209    font-weight: 400;
1210    color: var(--color-text-quiet);
1211  }
1212  
1213  .cn-stop-status {
1214    flex: none;
1215    font-family: var(--font-mono);
1216    font-size: 9.5px;
1217    color: var(--color-text-eyebrow);
1218  }
1219  
1220  /* ── Transcript ──────────────────────────────────────────────────────────
1221     ⚠ A block is keyed on (member, phase, round) BY THE STORE — F37's fix, after
1222     a live run rendered 291 fragments where 8 turns belonged. Nothing here
1223     touches what defines a block; this styles the block. */
1224  
1225  /* ⚠ THE HEIGHT CAP IS THE POINT, NOT A TIDINESS CHOICE. A measured run wrote
1226     40,057 bytes of findings over 7 turns, and a full one reaches 13; unbounded,
1227     the transcript pushes the FINDINGS and ACCOUNTING panels below the fold, and
1228     those are the two things a finished run is actually read for. Capped in `vh`
1229     rather than pixels so it holds its share of the window at any size. */
1230  /* ⚠ IDENTICAL TO .cn-findings BELOW, DELIBERATELY — same well, same border,
1231     same radius, same padding, same scrollbar treatment. The two scrolling
1232     regions on this screen are the same kind of thing and must not look like two
1233     decisions. Only the height differs (34vh vs 48vh), because the transcript is
1234     the thing you skim and the findings are the thing you read. */
1235  .cn-transcript {
1236    max-height: 34vh;
1237    overflow-y: auto;
1238    background: var(--color-surface-well);
1239    border: 1px solid var(--color-border-panel);
1240    border-radius: var(--radius-rail);
1241    padding: 10px 12px;
1242  }
1243  
1244  /* The copy control. Quiet at rest — it is an escape hatch, not an action the
1245     screen is asking for. */
1246  .cn-copy {
1247    display: flex;
1248    align-items: center;
1249    gap: 5px;
1250    flex: none;
1251    border: 1px solid var(--color-border-badge);
1252    background: var(--color-surface-field);
1253    border-radius: var(--radius-icon);
1254    padding: 3px 8px;
1255    font-family: var(--font-mono);
1256    font-size: 9.5px;
1257    color: var(--color-text-quiet);
1258    cursor: default;
1259  }
1260  
1261  .cn-copy:hover {
1262    border-color: var(--color-logo-bar-low);
1263    color: var(--color-text-body);
1264  }
1265  
1266  /* ⚠ FLAT, NOT A CARD. A bordered card inside the bordered well inside the
1267     bordered panel is three nested boxes, which is what "a window inside a
1268     window" describes. A turn is a block in a document — separated by a rule,
1269     the way the findings document separates its own sections. */
1270  .cn-turn {
1271    padding: 10px 0;
1272    border-top: 1px solid var(--color-border-panel);
1273  }
1274  
1275  .cn-turn:first-child {
1276    padding-top: 2px;
1277    border-top: 0;
1278  }
1279  
1280  .cn-turn-head {
1281    display: flex;
1282    align-items: baseline;
1283    gap: 9px;
1284  }
1285  
1286  .cn-turn-who {
1287    font-size: 11.5px;
1288    font-weight: 600;
1289    color: var(--color-text-primary);
1290  }
1291  
1292  .cn-turn-meta {
1293    font-family: var(--font-mono);
1294    font-size: 9.5px;
1295    color: var(--color-text-eyebrow);
1296  }
1297  
1298  .cn-turn-body {
1299    margin-top: 6px;
1300    font-family: var(--font-sans);
1301    font-size: 12px;
1302    line-height: 1.6;
1303    color: var(--color-text-body);
1304    white-space: pre-wrap;
1305    overflow-wrap: break-word;
1306  }
1307  
1308  /* A refused turn is a ROW, not a gap — and now that turns are flat, it earns
1309     its distinction from a left accent rather than from a box. */
1310  .cn-turn-refused {
1311    border-left: 2px solid color-mix(in srgb, var(--color-state-error) 55%, transparent);
1312    padding-left: 10px;
1313  }
1314  
1315  .cn-turn-refused-tag {
1316    font-family: var(--font-mono);
1317    font-size: 9.5px;
1318    color: var(--color-state-error-text);
1319  }
1320  
1321  .cn-turn-refused-why {
1322    margin-top: 6px;
1323    font-family: var(--font-mono);
1324    font-size: 11px;
1325    line-height: 1.6;
1326    color: var(--color-state-error-text);
1327  }
1328  
1329  .cn-nextup {
1330    display: flex;
1331    align-items: center;
1332    gap: 9px;
1333    padding: 7px 10px;
1334    border: 1px dashed var(--color-border-inset);
1335    border-radius: var(--radius-rail);
1336    opacity: 0.6;
1337    font-family: var(--font-mono);
1338    font-size: 10px;
1339    color: var(--color-text-quiet);
1340  }
1341  
1342  /* ── Result: findings beside accounting ──────────────────────────────────── */
1343  .cn-result {
1344    display: flex;
1345    gap: 12px;
1346    align-items: flex-start;
1347    margin-top: 20px;
1348    min-width: 0;
1349  }
1350  
1351  .cn-panel {
1352    background: var(--color-surface-inset);
1353    border: 1px solid var(--color-border-inset);
1354    border-radius: var(--radius-card);
1355    overflow: hidden;
1356  }
1357  
1358  /* ⚠ A panel that is a direct child of the main flex COLUMN must opt out of
1359     shrinking, or the column squeezes it to a single line — which is exactly what
1360     happened to the transcript the first time it became a panel. The findings
1361     panel does not need this: it sits in a flex ROW and takes `flex-1` there. */
1362  .cn-panel-static {
1363    flex: none;
1364  }
1365  
1366  .cn-panel-head {
1367    display: flex;
1368    align-items: center;
1369    gap: 10px;
1370    padding: 9px 13px;
1371    border-bottom: 1px solid var(--color-border-panel);
1372  }
1373  
1374  .cn-panel-body {
1375    padding: 12px 13px;
1376  }
1377  
1378  /* ⚠ THE STANDING CAVEAT. Above the synthesis, unconditional, not dismissible,
1379     and deliberately given the attention treatment rather than a quiet grey —
1380     it is the one thing on this screen a reader must not skim past.
1381     ⚠ NO SUCCESS CHROME ANYWHERE IN THIS VIEW: no checkmark, no green "complete"
1382     badge. A finished run reads as FINISHED, never as CORRECT. */
1383  .cn-caveat {
1384    border: 1px solid color-mix(in srgb, var(--color-state-attention) 35%, transparent);
1385    background: color-mix(in srgb, var(--color-state-attention) 7%, transparent);
1386    border-radius: var(--radius-rail);
1387    padding: 8px 12px;
1388    font-size: 11.5px;
1389    line-height: 1.6;
1390    color: var(--color-state-attention-text);
1391  }
1392  
1393  .cn-findings {
1394    margin-top: 12px;
1395    max-height: 48vh;
1396    overflow: auto;
1397    background: var(--color-surface-well);
1398    border: 1px solid var(--color-border-panel);
1399    border-radius: var(--radius-rail);
1400    padding: 10px 12px;
1401    font-family: var(--font-sans);
1402    font-size: 12px;
1403    line-height: 1.65;
1404    color: var(--color-text-body);
1405    white-space: pre-wrap;
1406    overflow-wrap: break-word;
1407  }
1408  
1409  /* The stored transcript shares the findings well — same border, same inset,
1410     same height — and fills it with `.cn-turn` blocks instead of a document. The
1411     well is the panel's ONE scrolling region either way, which is what keeps the
1412     accounting panel beside it on screen. `pre-wrap` belongs to the document, not
1413     to the blocks, so it is undone here. */
1414  .cn-stored-transcript {
1415    white-space: normal;
1416  }
1417  
1418  /* ── The findings / transcript toggle (D97) ───────────────────────────────
1419     The `overlay-segmented` anatomy — one bordered container, a quiet inactive
1420     segment, dividers between — at the mock's HEADER scale rather than the
1421     dialog's: 9.5px mono, 2px 9px padding, sized to its label instead of filling
1422     the row. */
1423  .cn-seg {
1424    display: flex;
1425    flex: none;
1426    border: 1px solid var(--color-border-inset);
1427    background: var(--color-surface-well);
1428    border-radius: var(--radius-icon);
1429    overflow: hidden;
1430  }
1431  
1432  .cn-seg-btn {
1433    border: 0;
1434    border-left: 1px solid var(--color-border-segment);
1435    background: transparent;
1436    padding: 2px 9px;
1437    font-family: var(--font-mono);
1438    font-size: 9.5px;
1439    color: var(--color-text-quiet);
1440    cursor: default;
1441    white-space: nowrap;
1442  }
1443  
1444  .cn-seg-btn:first-child {
1445    border-left: 0;
1446  }
1447  
1448  .cn-seg-btn:hover:not(.cn-seg-on) {
1449    color: var(--color-text-body);
1450  }
1451  
1452  .cn-seg-on {
1453    background: var(--color-surface-badge);
1454    color: var(--color-text-primary);
1455  }
1456  
1457  /* ── Accounting ──────────────────────────────────────────────────────────── */
1458  .cn-accounting {
1459    width: 330px;
1460    flex: none;
1461  }
1462  
1463  .cn-denominator-note {
1464    flex: none;
1465    font-family: var(--font-mono);
1466    font-size: 9px;
1467    color: var(--color-logo-bar-low);
1468  }
1469  
1470  .cn-acct-body {
1471    padding: 12px 13px;
1472    display: flex;
1473    flex-direction: column;
1474    gap: 11px;
1475  }
1476  
1477  .cn-acct-group {
1478    display: flex;
1479    flex-direction: column;
1480    gap: 5px;
1481  }
1482  
1483  .cn-acct-label {
1484    font-family: var(--font-mono);
1485    font-size: 9px;
1486    letter-spacing: 0.14em;
1487    color: var(--color-text-eyebrow);
1488  }
1489  
1490  .cn-acct-figure {
1491    font-family: var(--font-mono);
1492    font-size: 12px;
1493    color: var(--color-text-primary);
1494  }
1495  
1496  /* The connective word inside a figure is quieter than the numbers it joins —
1497     which is how "3 answered of 4 planned" reads as one fact rather than two. */
1498  .cn-acct-of {
1499    color: var(--color-text-quiet);
1500  }
1501  
1502  .cn-acct-cost {
1503    font-family: var(--font-mono);
1504    font-size: 17px;
1505    color: var(--color-text-primary);
1506  }
1507  
1508  .cn-acct-sub {
1509    font-family: var(--font-mono);
1510    font-size: 10px;
1511    line-height: 1.6;
1512    color: var(--color-text-quiet);
1513  }
1514  
1515  .cn-acct-sub-bad {
1516    color: var(--color-state-error-text);
1517  }
1518  
1519  .cn-acct-sub-bright {
1520    color: var(--color-text-muted);
1521  }
1522  
1523  .cn-acct-rule {
1524    height: 1px;
1525    background: var(--color-border-panel);
1526  }
1527  
1528  /* The usage-coverage bar: reported against absent, drawn to scale. It is the
1529     only place a proportion is drawn, and it is drawn because both halves of it
1530     are measured — unlike the progress bar the phase track refuses. */
1531  .cn-coverage {
1532    display: flex;
1533    gap: 2px;
1534    margin-top: 2px;
1535  }
1536  
1537  .cn-coverage-on,
1538  .cn-coverage-off {
1539    height: 4px;
1540    border-radius: var(--radius-bar);
1541  }
1542  
1543  .cn-coverage-on {
1544    background: var(--color-logo-bar-low);
1545  }
1546  
1547  .cn-coverage-off {
1548    background: var(--color-border-inset);
1549  }
1550  
1551  /* ── Scrollbars ──────────────────────────────────────────────────────────── */
1552  .cn-main::-webkit-scrollbar,
1553  .cn-rail::-webkit-scrollbar,
1554  .cn-findings::-webkit-scrollbar,
1555  .cn-transcript::-webkit-scrollbar {
1556    width: 10px;
1557  }
1558  
1559  .cn-main::-webkit-scrollbar-track,
1560  .cn-rail::-webkit-scrollbar-track,
1561  .cn-findings::-webkit-scrollbar-track,
1562  .cn-transcript::-webkit-scrollbar-track {
1563    background: transparent;
1564  }
1565  
1566  .cn-main::-webkit-scrollbar-thumb,
1567  .cn-rail::-webkit-scrollbar-thumb,
1568  .cn-findings::-webkit-scrollbar-thumb,
1569  .cn-transcript::-webkit-scrollbar-thumb {
1570    background: var(--color-border-badge);
1571    border-radius: 5px;
1572    border: 3px solid transparent;
1573    background-clip: padding-box;
1574  }
1575  
1576  .cn-main::-webkit-scrollbar-thumb:hover,
1577  .cn-rail::-webkit-scrollbar-thumb:hover,
1578  .cn-findings::-webkit-scrollbar-thumb:hover,
1579  .cn-transcript::-webkit-scrollbar-thumb:hover {
1580    background: var(--color-logo-bar-low);
1581    background-clip: padding-box;
1582  }
1583  </style>
1584  
```

### Exhibit 4 — `src/main/db/schema.ts` (lines 1–533, 26751 bytes)

```ts
  1  import { sqliteTable, text, integer, blob, real, primaryKey } from 'drizzle-orm/sqlite-core'
  2  
  3  /**
  4   * Drizzle table definitions mirroring the existing hand-rolled DDL, plus the
  5   * `sessions` table (migration version 2) and the `worktrees` table
  6   * (migration version 4, Phase 2).
  7   *
  8   * Deliberate scope cut (D7): Drizzle provides schema TYPES + TYPED QUERIES
  9   * only. Migrations stay in the hand-rolled MIGRATIONS array + the
 10   * schema_migrations runner in storage.ts — swapping the migration engine and
 11   * the query layer at the same time doubles risk. drizzle-kit migrations can
 12   * be revisited when schema churn grows.
 13   */
 14  
 15  export const projects = sqliteTable('projects', {
 16    id: text('id').primaryKey(),
 17    name: text('name').notNull(),
 18    rootPath: text('root_path').notNull().unique(),
 19    createdAt: text('created_at').notNull(),
 20    // v13 — both nullable. `color` NULL means "never chosen", which the rail
 21    // reads as its pre-v13 index cycle; see the migration's own note.
 22    color: text('color'),
 23    description: text('description')
 24  })
 25  
 26  export const paneLayouts = sqliteTable('pane_layouts', {
 27    projectId: text('project_id')
 28      .primaryKey()
 29      .references(() => projects.id),
 30    layoutJson: text('layout_json').notNull()
 31  })
 32  
 33  export const settings = sqliteTable('settings', {
 34    key: text('key').primaryKey(),
 35    value: text('value').notNull()
 36  })
 37  
 38  export const schemaMigrations = sqliteTable('schema_migrations', {
 39    version: integer('version').primaryKey(),
 40    appliedAt: text('applied_at').notNull()
 41  })
 42  
 43  /**
 44   * Stable session identity: one row per session, with an id that survives PTY
 45   * re-creation and app restarts. From Task 1-2 on, session identity is this row
 46   * id — the PTY instance is ephemeral and re-created under the same id.
 47   */
 48  export const sessions = sqliteTable('sessions', {
 49    id: text('id').primaryKey(),
 50    projectId: text('project_id')
 51      .notNull()
 52      .references(() => projects.id),
 53    agent: text('agent').notNull(), // 'claude' | 'codex'
 54    cwd: text('cwd').notNull(),
 55    status: text('status').notNull(), // 'running' | 'exited'
 56    exitCode: integer('exit_code'),
 57    // Nullable (D19): NULL until a title event (OSC 0/2 or first-line fallback)
 58    // lands via session:set-title. Matches migration v3's DDL exactly.
 59    title: text('title'),
 60    worktreeId: text('worktree_id'), // nullable; set when a session owns a worktree (D26 Q1/(a))
 61    createdAt: text('created_at').notNull(),
 62    // v10 (Phase 3a / D43): a SOFT pointer to the launch_profiles row this
 63    // session was launched under — deliberately NO .references(): a session row
 64    // is history and must survive its profile's deletion, exactly as 3a-1's
 65    // dispatches survive their session's, and sessions are themselves deleted on
 66    // pane close (D16 resolution d). An unresolvable value (a deleted profile, or
 67    // the LEGACY_CREDENTIALED_PROFILE_ID sentinel written by v10's data
 68    // migration) is read FAIL-SAFE as "credentialed" — see launchProfiles.ts.
 69    //
 70    // THIS COLUMN REPLACES Task 3-6's global `credentialed_sessions` settings
 71    // list (D49): the credentialed fact is now per-session, and therefore
 72    // per-project, which is what retires the Phase-3-only global-scoping
 73    // expedient the roadmap flagged.
 74    launchProfileId: text('launch_profile_id')
 75  })
 76  
 77  /**
 78   * Phase 2 / D26 action 1: one row per managed git worktree. DB-first journaled
 79   * (status 'creating' before any fs/git op; 'active' only after success);
 80   * states creating → provisioning → active → detached → removing. A worktree
 81   * outlives its owning session by design (D26 Q1). Matches migration v4's DDL.
 82   */
 83  export const worktrees = sqliteTable('worktrees', {
 84    id: text('id').primaryKey(),
 85    projectId: text('project_id')
 86      .notNull()
 87      .references(() => projects.id),
 88    // Nullable, NO cascade: a detached worktree has session_id = NULL and so
 89    // does not block the owning session's deletion (D26 Q1). NOTE: enforced,
 90    // not documentation-only — better-sqlite3 v12 turns PRAGMA foreign_keys=ON
 91    // by default, so 2-3's delete flow must detach BEFORE deleting a session.
 92    sessionId: text('session_id').references(() => sessions.id),
 93    path: text('path').notNull().unique(),
 94    branch: text('branch').notNull(),
 95    baseBranch: text('base_branch').notNull(),
 96    repoRoot: text('repo_root').notNull(),
 97    // 'creating' | 'provisioning' | 'active' | 'detached' | 'removing'
 98    status: text('status').notNull(),
 99    createdAt: text('created_at').notNull()
100  })
101  
102  export type ProjectRow = typeof projects.$inferSelect
103  export type PaneLayoutRow = typeof paneLayouts.$inferSelect
104  export type SessionRow = typeof sessions.$inferSelect
105  export type NewSessionRow = typeof sessions.$inferInsert
106  export type WorktreeRow = typeof worktrees.$inferSelect
107  export type NewWorktreeRow = typeof worktrees.$inferInsert
108  
109  /**
110   * Phase 3 / D33 action 1 + resolution (e): one row per provider connection —
111   * NON-SECRET metadata only (base_url / extra_headers_json are documented
112   * non-secret; the credential envelope's own values override them). Secrets
113   * never live here. Matches migration v5's DDL column for column.
114   */
115  export const providerConfigs = sqliteTable('provider_configs', {
116    id: text('id').primaryKey(),
117    name: text('name').notNull(),
118    adapterType: text('adapter_type').notNull(),
119    authMode: text('auth_mode').notNull(),
120    // D34(e): overrides the adapter's AuthMethodDefinition.requiredEnvVar for
121    // custom / OpenAI-compatible endpoints. NULL = use the adapter default.
122    envVarName: text('env_var_name'),
123    // Plaintext and DOCUMENTED NON-SECRET (D33 resolution e). The credential
124    // envelope's own baseUrl/extraHeaders override these when present.
125    baseUrl: text('base_url'),
126    extraHeadersJson: text('extra_headers_json'),
127    // D48 (migration v6): the route's DEFAULT model id (e.g. an OpenRouter
128    // model slug). Nullable — a subscription route has no model to name. A
129    // default, not an authority: Phase 3a's launch_profiles will override it.
130    // Matches migration v6's DDL exactly.
131    model: text('model'),
132    createdAt: text('created_at').notNull()
133  })
134  
135  /**
136   * Phase 3 / D33: one row per stored credential. The envelope ({key, baseUrl?,
137   * extraHeaders?}) lives ONLY inside encrypted_blob (safeStorage/DPAPI); every
138   * other column is plaintext metadata that lets the UI list and disambiguate
139   * profiles without decrypting. UNIQUE (provider_id, label) is enforced by the
140   * hand-rolled DDL (D7: Drizzle is types + queries only) and throws
141   * SQLITE_CONSTRAINT_UNIQUE on a duplicate — caught and converted by the vault.
142   */
143  export const credentialProfiles = sqliteTable('credential_profiles', {
144    id: text('id').primaryKey(),
145    // ENFORCED FK (F16): deleting a provider that still has profiles throws
146    // SQLITE_CONSTRAINT_FOREIGNKEY — provider:delete must count-and-refuse
147    // BEFORE SQLite throws.
148    providerId: text('provider_id')
149      .notNull()
150      .references(() => providerConfigs.id),
151    label: text('label').notNull(),
152    // The safeStorage/DPAPI envelope. mode:'buffer' keeps better-sqlite3's
153    // native Buffer round-trip — a text column would corrupt binary output.
154    encryptedBlob: blob('encrypted_blob', { mode: 'buffer' }).notNull(),
155    // Salted SHA-256, MAIN-SIDE ONLY (D33 resolution b): duplicate detection at
156    // creation and rotation detection. Never crosses IPC.
157    fingerprintHash: text('fingerprint_hash').notNull(),
158    createdAt: text('created_at').notNull(),
159    lastVerifiedAt: text('last_verified_at'),
160    // D33 clause 8: set when decryption fails; the row SURVIVES and launches
161    // naming this profile are refused by label.
162    unavailableSince: text('unavailable_since'),
163    // D33 risk 7 throttle for the shouldReEncrypt path.
164    reencryptedAt: text('reencrypted_at')
165  })
166  
167  export type ProviderConfigRow = typeof providerConfigs.$inferSelect
168  export type NewProviderConfigRow = typeof providerConfigs.$inferInsert
169  export type CredentialProfileRow = typeof credentialProfiles.$inferSelect
170  export type NewCredentialProfileRow = typeof credentialProfiles.$inferInsert
171  
172  /**
173   * Phase 3a / Task 3a-1 (migration v7): one row per agent RUN. Mission Control
174   * spec §5.2 + §9 Phase 0.
175   *
176   * A dispatch is NOT a session. One sessions row may own MANY dispatches over
177   * its life (each restore relaunch is a fresh conversation, Phase 8 open
178   * question 1), and a dispatch OUTLIVES its session row (pane close deletes it,
179   * D16 resolution d). Hence NO .references() on any column here — the FK would
180   * be enforced (F16) and RESTRICT would break session:delete. session_id and
181   * project_id are opaque strings.
182   *
183   * The token/cost columns live on THIS row, not in a separate usage_records
184   * table: they describe the same run (D48 — one home, not two). Written by
185   * Task 3a-3; NULL until then.
186   */
187  export const dispatches = sqliteTable('dispatches', {
188    id: text('id').primaryKey(),
189    sessionId: text('session_id'),
190    projectId: text('project_id'),
191    // Nullable and unwritten until a task seed exists (spec §9 Phase 0).
192    taskId: text('task_id'),
193    agent: text('agent').notNull(),
194    model: text('model'),
195    providerName: text('provider_name'),
196    // D42: attribution strategy is keyed on auth mode. 'subscription' | 'api_key'.
197    authMode: text('auth_mode').notNull(),
198    cwd: text('cwd').notNull(),
199    startedAt: text('started_at').notNull(),
200    // NULL after close means the end was never OBSERVED (boot-healed orphan).
201    endedAt: text('ended_at'),
202    // NULL means OPEN. 'completed' | 'abandoned' | 'failed'.
203    outcome: text('outcome'),
204    // 'exit' | 'kill' | 'dispose' | 'boot-heal'.
205    closedBy: text('closed_by'),
206    exitCode: integer('exit_code'),
207    tokensIn: integer('tokens_in'),
208    tokensOut: integer('tokens_out'),
209    // Separate on purpose: cached input is ~an order of magnitude cheaper
210    // (spec §5.1), and folding it in projects wrong in the expensive direction.
211    tokensCached: integer('tokens_cached'),
212    costUsd: real('cost_usd'),
213  
214    /* -- Task 3a-3 (migration v8): the mint ledger, on THIS row -------------
215     * NOT a second table. A mint belongs to a dispatch one-to-one, and a
216     * separate table would immediately need a join, an FK (F16: enforced), and
217     * its own orphan story — D48's anti-goal, restated. Same no-REFERENCES rule
218     * as the columns above.
219     */
220    // The minted key's hash — an IDENTIFIER, not a secret: it cannot
221    // authenticate. It is also the value the analytics `api_key_id` filter
222    // wants (D4 obligation 1, verified 2026-07-25). NULL for subscription,
223    // mint-failed and never-attributed rows. The KEY ITSELF IS NEVER STORED.
224    mintedKeyHash: text('minted_key_hash'),
225    // The cap that was actually applied — evidence, not configuration. Read back
226    // from the create response rather than echoed from the request, so the row
227    // records what OpenRouter accepted.
228    mintedKeyLimit: real('minted_key_limit'),
229    // ISO-8601. Also the analytics query's window START.
230    mintedAt: text('minted_at'),
231    // ⚠ NULL means THE LEDGER ROW IS OPEN. This single field is what boot
232    // reconciliation queries, which is why it is nullable rather than defaulted.
233    revokedAt: text('revoked_at'),
234    // NOT NULL with a default, because a row whose state is unknown is a row
235    // nobody can reason about later. Vocabulary in attributionCore's
236    // AttributionState. Pre-v8 rows read 'none', which is exactly true of them.
237    attributionState: text('attribution_state').notNull().default('none'),
238    // 'analytics' | 'analytics-derived' | 'cli-logs' | NULL = unknown.
239    // Nullable because unknown is a real and frequent answer (§8).
240    tokensSource: text('tokens_source')
241  })
242  
243  /**
244   * Phase 3a / Task 3a-1 (migration v7): attention-minutes, spec §5.3. Created
245   * here so this phase's schema churn stays in ONE migration; TASK 3a-2 IS ITS
246   * ONLY WRITER and this task leaves it empty. Same no-FK rule as dispatches.
247   * `class` and `tick_seconds` were added to v7 by coordinator amendment
248   * (2026-07-24) on 3a-2's dependency finding: without the class there is no
249   * denominator for "% of measured time that was pane-focused", and the tick
250   * granularity must be recorded so a later cadence change cannot silently
251   * corrupt rows written under the old one.
252   */
253  export const attentionSpans = sqliteTable('attention_spans', {
254    id: text('id').primaryKey(),
255    dispatchId: text('dispatch_id'),
256    sessionId: text('session_id'),
257    // Set (with a null dispatch/session) for the per-project overhead bucket.
258    projectId: text('project_id'),
259    startedAt: text('started_at').notNull(),
260    endedAt: text('ended_at').notNull(),
261    // Stored, not derived: a one-tap correction changes the number without
262    // changing the interval.
263    seconds: integer('seconds').notNull(),
264    // The attention class the span was credited to (pane / overhead / idle /
265    // blurred / locked, per 3a-2's focus-state table).
266    class: text('class').notNull(),
267    // The sampling granularity the span was accumulated at.
268    tickSeconds: integer('tick_seconds').notNull(),
269    // 'measured' | 'corrected'.
270    source: text('source').notNull(),
271    createdAt: text('created_at').notNull()
272  })
273  
274  export type DispatchRow = typeof dispatches.$inferSelect
275  export type NewDispatchRow = typeof dispatches.$inferInsert
276  export type AttentionSpanRow = typeof attentionSpans.$inferSelect
277  export type NewAttentionSpanRow = typeof attentionSpans.$inferInsert
278  
279  /**
280   * Phase 3a / Task 3a-4 (migration v9): the model catalog.
281   *
282   * ⚠ A LIST OF WHAT EXISTS — NOT AN AUTHORITY. Precedence for "which model
283   * does this launch use" is, in order: launch_profiles.model (3a-5) >
284   * provider_configs.model (v6, D48) > nothing (the CLI's own default). This
285   * table is NOT in that order and never writes to either home. See the v9
286   * migration comment in storage.ts for the full ruling.
287   *
288   * No REFERENCES to provider_configs: FKs are ENFORCED (F16) and RESTRICT
289   * would make provider:delete throw. Purge is explicit, in the delete's own
290   * transaction.
291   */
292  export const modelCatalog = sqliteTable(
293    'model_catalog',
294    {
295      providerId: text('provider_id').notNull(),
296      modelId: text('model_id').notNull(),
297      displayName: text('display_name').notNull(),
298      contextLength: integer('context_length'),
299      /** Provider-announced retirement (OpenRouter `expiration_date`). */
300      expiresAt: text('expires_at'),
301      firstSeenAt: text('first_seen_at').notNull(),
302      refreshedAt: text('refreshed_at').notNull(),
303      /** Set ONCE when a refresh stops seeing this id; cleared when it returns;
304       *  never moved while it stays missing. The row is never deleted. */
305      missingSince: text('missing_since')
306    },
307    (t) => ({ pk: primaryKey({ columns: [t.providerId, t.modelId] }) })
308  )
309  
310  export type ModelCatalogRow = typeof modelCatalog.$inferSelect
311  export type NewModelCatalogRow = typeof modelCatalog.$inferInsert
312  
313  /**
314   * v12 (Phase 3d / Task 3d-2, D85): the user's SHORTLIST — which of a route's
315   * models they actually intend to use. OpenRouter alone lists ~340; a launch
316   * picker built on that number is not a picker.
317   *
318   * ⚠ A SEPARATE TABLE, NOT A COLUMN ON `model_catalog`, AND THE REASON IS THE
319   * WHOLE DESIGN. `model_catalog` is a CACHE of what a provider says exists —
320   * written only by a refresh diff, and explicitly never an authority (D56).
321   * This is the opposite kind of fact: it is USER INTENT, written only by a
322   * click, and no refresh may ever touch it. Putting a `favourite` flag on a
323   * cache row would make one table mean two things, and the first `DELETE FROM
324   * model_catalog` written by someone tidying a cache would silently destroy a
325   * curation the user built by hand.
326   *
327   * ⚠ AND IT IS DELIBERATELY NOT A FOREIGN KEY ONTO `model_catalog`. A user must
328   * be able to shortlist an id the catalog has never seen — the same freedom
329   * D48/D56 protect by keeping the provider's default model a FREE-TEXT input
330   * with a `<datalist>` rather than a closed `<select>`. A shortlist that could
331   * only contain ids a refresh happened to return would make the catalog
332   * authoritative by schema, which is exactly the ruling those decisions exist
333   * to prevent. A shortlisted id therefore SURVIVES the model going missing,
334   * survives the catalog being emptied, and survives never having been in it.
335   *
336   * No REFERENCES to provider_configs either, for `model_catalog`'s own reason:
337   * FKs are ENFORCED (F16) and RESTRICT would make provider:delete throw. Purge
338   * is explicit, in the delete's own transaction.
339   */
340  export const modelShortlist = sqliteTable(
341    'model_shortlist',
342    {
343      providerId: text('provider_id').notNull(),
344      modelId: text('model_id').notNull(),
345      /** When the user chose it. Ordering is by this, NOT by display name: a
346       *  shortlist is a personal list and the order you built it in is
347       *  information the alphabet does not carry. */
348      addedAt: text('added_at').notNull()
349    },
350    (t) => ({ pk: primaryKey({ columns: [t.providerId, t.modelId] }) })
351  )
352  
353  export type ModelShortlistRow = typeof modelShortlist.$inferSelect
354  export type NewModelShortlistRow = typeof modelShortlist.$inferInsert
355  
356  /**
357   * Phase 3a / D43 (Task 3a-5): the launchable unit — (agent x route x model) —
358   * as one user-named row. The id is IMMUTABLE and is what every reference
359   * stores; the label is freely renameable and is what the picker shows. Two
360   * routes to the same model are TWO ROWS, deliberately (`OR/DeepSeek v4 Pro` vs
361   * `Direct/DeepSeek`), and nothing may dedupe or collapse them.
362   *
363   * Matches migration v10's DDL column for column. NOTE the FK asymmetry, which
364   * is intentional and argued at the migration: this table REFERENCES its targets
365   * (a live instruction must not outlive them), while sessions.launch_profile_id
366   * does NOT reference this table (a session row is history and must outlive the
367   * profile).
368   */
369  export const launchProfiles = sqliteTable('launch_profiles', {
370    id: text('id').primaryKey(),
371    label: text('label').notNull().unique(),
372    // Authoritative EVEN WHEN a route is present. provider_id is nullable, so a
373    // route-less profile (the plain "Claude Code on my subscription" profile most
374    // users save first) has nowhere else to record its agent. Drift against
375    // provider_configs.adapter_type is closed by validateProfileShape's equality
376    // check, not by a CHECK constraint — one authoritative field, one validator.
377    agent: text('agent').notNull(),
378    // NULL = no route: today's first-class ambient/subscription launch (D33
379    // clause 9). ENFORCED FK (F16) when set.
380    providerId: text('provider_id').references(() => providerConfigs.id),
381    // NULL = this profile holds no credential. THIS COLUMN IS THE CREDENTIALED
382    // PREDICATE: sessionIsCredentialed reads it through the profile pointer.
383    credentialProfileId: text('credential_profile_id').references(() => credentialProfiles.id),
384    // Precedence rank 1 (3a-4's normative table). NULL falls through to the
385    // route's provider_configs.model (rank 2, D48). ⚠ NEVER BACK-WRITTEN —
386    // copying the route default in here would create the second home for "which
387    // model" that D48 exists to prevent, by another name.
388    model: text('model'),
389    // An EffortOption.id from 3a-4's effortLevelSchema — IMPORTED, never
390    // re-declared. 3a-5 persists it and hands it to 3a-4's LaunchOptions.effort
391    // seam; 3a-4's resolveEffortArgs owns every mapping decision, and no adapter
392    // file changes here. Rank 2 of 3a-4's effort order (raw extra_args still
393    // wins); a profile does not create a rank 0.
394    effort: text('effort'),
395    // Stored; consumed by NOTHING in 3a-5. Mapping it onto a CLI flag is D4
396    // material AND an adapter change, and neither is in scope. The column exists
397    // now so schema churn stays in one migration (the attention_spans precedent).
398    permissionMode: text('permission_mode'),
399    // 'current-tree' | 'new-worktree' only — 'existing-worktree' names a specific
400    // transient worktree row and is refused at create/update.
401    workspaceMode: text('workspace_mode').notNull(),
402    // JSON object of NON-SECRET string->string env additions, refused at write if
403    // it carries a known key shape (the extra_headers_json precedent).
404    envJson: text('env_json'),
405    createdAt: text('created_at').notNull(),
406    // Exists so a rename is visible without a second table.
407    updatedAt: text('updated_at').notNull()
408  })
409  
410  export type LaunchProfileRow = typeof launchProfiles.$inferSelect
411  export type NewLaunchProfileRow = typeof launchProfiles.$inferInsert
412  
413  /**
414   * Phase 3b / Task 3b-2 (migration v11), D62: WHO the council's members are.
415   *
416   * ⚠ NO `provider_id` AND NO `base_url` COLUMN, and that is the headline ruling
417   * rather than an omission. The route has ONE home — `provider_configs` (D48) —
418   * and a credential already knows its route through
419   * `credential_profiles.provider_id`, so a member NAMES A ROUTE BY NAMING A
420   * CREDENTIAL. `launch_profiles` above carries both columns only because D33
421   * clause 9 makes a route-with-no-credential first class; a council member that
422   * cannot authenticate cannot deliberate, so that case does not exist here and
423   * two columns that can disagree would be a bug class, not a convenience.
424   *
425   * ⚠ The roadmap's own Phase 3b line still says a member is "credential profile
426   * + base URL + model id + role + params". That phrasing predates D48/D56 and
427   * is superseded by this table.
428   *
429   * The FK is REAL and ENFORCED (F16) — a member is a live INSTRUCTION and is a
430   * lie once its credential is gone. RESTRICT is what makes the refusal
431   * mandatory; `countCouncilMembersForCredential` is what AUTHORS it, before the
432   * delete statement runs. Matches migration v11's DDL column for column.
433   */
434  export const councilMembers = sqliteTable('council_members', {
435    id: text('id').primaryKey(),
436    // UNIQUE, and freely renameable (D43): the label is not the identity. Every
437    // pointer stores the immutable id, so a rename has zero downstream effect.
438    label: text('label').notNull().unique(),
439    // NOT NULL — the only REFERENCES in this whole migration.
440    credentialProfileId: text('credential_profile_id')
441      .notNull()
442      .references(() => credentialProfiles.id),
443    // D56 rank 1. NULL falls through to the ROUTE's provider_configs.model
444    // (rank 2), then to nothing. ⚠ NEVER BACK-WRITTEN — copying the route default
445    // in here is how the second home D48 forbids gets created by accident.
446    model: text('model'),
447    // 'member' | 'arbiter'. Free-text column, validated by councilRoleSchema in
448    // MAIN — no CHECK constraint, matching auth_mode and status everywhere else.
449    role: text('role').notNull(),
450    // Temperature, top_p, and whatever else a member needs. Defensively parsed on
451    // read (degrades to {} on corruption, the extra_headers_json /
452    // getWindowBounds precedent) and REFUSED AT WRITE if it carries a known key
453    // shape — a member's parameters are never a place for a credential.
454    paramsJson: text('params_json'),
455    createdAt: text('created_at').notNull(),
456    updatedAt: text('updated_at').notNull()
457  })
458  
459  /**
460   * Phase 3b / Task 3b-2 (migration v11): WHAT a run was.
461   *
462   * ⚠ NO `REFERENCES` ON ANY COLUMN, the deliberate inverse of councilMembers
463   * above and the same ruling v7's `dispatches` and v9's `model_catalog` took: a
464   * run is a historical FACT. It stays true after its project or a member is
465   * deleted, and an enforced FK (F16) would make deleting a member THROW for
466   * every run it ever joined. project_id is an opaque string here.
467   *
468   * The four mint columns mirror v8's ledger exactly, `revoked_at IS NULL`
469   * included — that predicate IS the definition of an open ledger row. THE
470   * MINTED KEY ITSELF IS NEVER STORED; `minted_key_hash` cannot authenticate.
471   *
472   * ⚠ CREATED EMPTY. Task 3b-3 is its only writer (the `attention_spans`
473   * precedent); nothing in Task 3b-2 inserts a row.
474   */
475  export const councilRuns = sqliteTable('council_runs', {
476    id: text('id').primaryKey(),
477    projectId: text('project_id'),
478    briefPath: text('brief_path').notNull(),
479    // NULL until the findings .md is written beside the brief (3b-4).
480    findingsPath: text('findings_path'),
481    status: text('status').notNull(),
482    startedAt: text('started_at').notNull(),
483    endedAt: text('ended_at'),
484    // D64(2): ONE minted key per RUN, with a hard cap that must clear the
485    // members' max OUTPUT allocation rather than their expected spend (3a-3's
486    // measured lesson — OpenRouter pre-authorizes against the remaining limit).
487    mintedKeyHash: text('minted_key_hash'),
488    mintedKeyLimit: real('minted_key_limit'),
489    mintedAt: text('minted_at'),
490    // ⚠ NULL means THE LEDGER ROW IS OPEN. Nullable rather than defaulted, for
491    // exactly the reason v8's dispatches.revoked_at is.
492    revokedAt: text('revoked_at'),
493    tokensIn: integer('tokens_in'),
494    tokensOut: integer('tokens_out'),
495    tokensCached: integer('tokens_cached'),
496    costUsd: real('cost_usd')
497  })
498  
499  /**
500   * Phase 3b / Task 3b-2 (migration v11): WHAT WAS SAID.
501   *
502   * ⚠ NO `REFERENCES`, for the same reason as councilRuns: a transcript is a
503   * historical fact and stays true once its member is deleted. run_id and
504   * member_id are opaque strings. Because SQLite will not cascade a soft
505   * pointer, `deleteCouncilRun` purges this table explicitly in one transaction
506   * (the deleteProviderConfig -> model_catalog precedent).
507   *
508   * ⚠ CREATED EMPTY. Task 3b-3 is its only writer.
509   */
510  export const councilMessages = sqliteTable('council_messages', {
511    id: text('id').primaryKey(),
512    runId: text('run_id').notNull(),
513    // NULLABLE: the synthesis and any orchestrator-authored framing have no
514    // member to attribute.
515    memberId: text('member_id'),
516    // Both NOT NULL: a transcript row whose position in the deliberation is
517    // unknown cannot be rendered or reasoned about later, and neither has an
518    // honest default.
519    round: integer('round').notNull(),
520    phase: text('phase').notNull(),
521    content: text('content').notNull(),
522    tokensIn: integer('tokens_in'),
523    tokensOut: integer('tokens_out'),
524    createdAt: text('created_at').notNull()
525  })
526  
527  export type CouncilMemberRow = typeof councilMembers.$inferSelect
528  export type NewCouncilMemberRow = typeof councilMembers.$inferInsert
529  export type CouncilRunRow = typeof councilRuns.$inferSelect
530  export type NewCouncilRunRow = typeof councilRuns.$inferInsert
531  export type CouncilMessageRow = typeof councilMessages.$inferSelect
532  export type NewCouncilMessageRow = typeof councilMessages.$inferInsert
533  
```


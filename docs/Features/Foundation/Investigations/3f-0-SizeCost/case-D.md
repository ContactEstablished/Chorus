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

### Exhibit 5 — `src/main/services/storage.ts` (lines 1–1956, 88117 bytes)

```ts
   1  import Database from 'better-sqlite3'
   2  import { randomUUID } from 'crypto'
   3  import { basename } from 'path'
   4  import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
   5  import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, max } from 'drizzle-orm'
   6  import * as schema from '../db/schema'
   7  import { attentionSpans, councilMembers, councilMessages, councilRuns, credentialProfiles, dispatches, launchProfiles, modelCatalog, modelShortlist, paneLayouts, projects, providerConfigs, sessions, settings, worktrees } from '../db/schema'
   8  import { logger } from './logger'
   9  import type { AttentionSpanRow, CouncilMemberRow, CouncilMessageRow, CouncilRunRow, CredentialProfileRow, DispatchRow, LaunchProfileRow, ModelCatalogRow, ModelShortlistRow, NewAttentionSpanRow, NewCouncilMemberRow, NewCouncilMessageRow, NewCouncilRunRow, NewCredentialProfileRow, NewDispatchRow, NewLaunchProfileRow, NewProviderConfigRow, NewSessionRow, NewWorktreeRow, ProviderConfigRow, SessionRow, WorktreeRow } from '../db/schema'
  10  import type { CatalogDiff } from './modelCatalogCore'
  11  import { sessionIsCredentialed } from './launchProfiles'
  12  import {
  13    attentionClassSchema,
  14    layoutJsonSchema,
  15    legacyFlatLayoutSchema,
  16    type AgentKind,
  17    type SessionStatus,
  18    type ViewState
  19  } from '../../shared/ipc'
  20  import { convertLegacyFlatLayout, normalizeTree, type LayoutJson } from '../../shared/layout'
  21  import { defaultProjectColor } from '../../shared/projectColors'
  22  
  23  export interface ProjectRecord {
  24    id: string
  25    name: string
  26    rootPath: string
  27    /** The user's chosen spine colour as `#RRGGBB`, or null when they have never
  28     *  chosen one — the rail then falls back to its index cycle (migration v13). */
  29    color: string | null
  30    /** Free-text notes, ≤1000 chars (enforced on the IPC boundary). Null when
  31     *  never written; the rail never renders this, the settings screen does. */
  32    description: string | null
  33  }
  34  
  35  /** The projects-table row -> the internal record. Explicit rather than a
  36   *  spread, the same discipline `toWireProject` follows: a future migration's
  37   *  new column must be admitted deliberately, not by accident. */
  38  function toProjectRecord(row: typeof projects.$inferSelect): ProjectRecord {
  39    return {
  40      id: row.id,
  41      name: row.name,
  42      rootPath: row.rootPath,
  43      color: row.color,
  44      description: row.description
  45    }
  46  }
  47  
  48  export interface WindowBounds {
  49    x: number
  50    y: number
  51    width: number
  52    height: number
  53  }
  54  
  55  /**
  56   * `council_runs.status` (v11) is unconstrained TEXT — no CHECK constraint,
  57   * matching `auth_mode`, `role` and every other status column in this schema —
  58   * so the vocabulary lives beside the table that persists it rather than in a
  59   * second home.
  60   *
  61   * ⚠ ONLY THE TWO THE BOOT HEAL NEEDS ARE DEFINED HERE (D66(d)). The rest of the
  62   * vocabulary arrives with the run lifecycle's only writer, `councilService.ts`,
  63   * beside these two. Defining terminal states before anything can reach them
  64   * would be a vocabulary nobody could check against a behaviour.
  65   */
  66  export const COUNCIL_RUN_RUNNING = 'running'
  67  /** What a crash leaves behind, once the boot heal has named it. Mirrors the
  68   *  dispatch heal's `abandoned` outcome deliberately: same fact, same word. */
  69  export const COUNCIL_RUN_ABANDONED = 'abandoned'
  70  /** The three terminal states `councilService.ts` writes, added with the run
  71   *  lifecycle's only writer (Task 3b-3) beside the two the boot heal needed. */
  72  export const COUNCIL_RUN_COMPLETE = 'complete'
  73  export const COUNCIL_RUN_FAILED = 'failed'
  74  export const COUNCIL_RUN_CANCELLED = 'cancelled'
  75  
  76  /** The closed vocabulary, so a reader has something to check a value against —
  77   *  the column itself is unconstrained TEXT and cannot. */
  78  export const COUNCIL_RUN_STATUSES: readonly string[] = [
  79    COUNCIL_RUN_RUNNING,
  80    COUNCIL_RUN_ABANDONED,
  81    COUNCIL_RUN_COMPLETE,
  82    COUNCIL_RUN_FAILED,
  83    COUNCIL_RUN_CANCELLED
  84  ]
  85  
  86  /**
  87   * Numbered migrations, applied in order inside a transaction. Table names
  88   * follow the master data model (docs/PLAN.md §13); columns arrive as the
  89   * features that need them do.
  90   *
  91   * The migration ENGINE stays hand-rolled (D7 scope cut): Drizzle provides
  92   * schema types + typed queries only. Version 2's DDL matches
  93   * src/main/db/schema.ts column names/types exactly.
  94   */
  95  const MIGRATIONS: string[] = [
  96    `CREATE TABLE projects (
  97       id         TEXT PRIMARY KEY,
  98       name       TEXT NOT NULL,
  99       root_path  TEXT NOT NULL UNIQUE,
 100       created_at TEXT NOT NULL
 101     );
 102     CREATE TABLE pane_layouts (
 103       project_id  TEXT PRIMARY KEY REFERENCES projects(id),
 104       layout_json TEXT NOT NULL
 105     );
 106     CREATE TABLE settings (
 107       key   TEXT PRIMARY KEY,
 108       value TEXT NOT NULL
 109     );`,
 110    `CREATE TABLE IF NOT EXISTS sessions (
 111       id          TEXT PRIMARY KEY,
 112       project_id  TEXT NOT NULL REFERENCES projects(id),
 113       agent       TEXT NOT NULL,
 114       cwd         TEXT NOT NULL,
 115       status      TEXT NOT NULL,
 116       exit_code   INTEGER,
 117       created_at  TEXT NOT NULL
 118     );`,
 119    // v3 (D19): nullable title, applied in place — existing rows back-fill to
 120    // NULL. Matches schema.ts's `title: text('title')` exactly (TEXT, nullable).
 121    `ALTER TABLE sessions ADD COLUMN title TEXT;`,
 122    // v4 (Phase 2 / D26 action 1): worktrees table + sessions.worktree_id.
 123    // Both statements apply atomically in the runner's transaction. DDL matches
 124    // schema.ts's worktrees table + worktreeId column exactly. REFERENCES here
 125    // is ENFORCED (better-sqlite3 v12 defaults PRAGMA foreign_keys=ON): inserts
 126    // must reference existing project/session rows; deletes of referenced
 127    // sessions throw until 2-3's detach-first flow runs.
 128    `CREATE TABLE worktrees (
 129       id          TEXT PRIMARY KEY,
 130       project_id  TEXT NOT NULL REFERENCES projects(id),
 131       session_id  TEXT REFERENCES sessions(id),
 132       path        TEXT NOT NULL UNIQUE,
 133       branch      TEXT NOT NULL,
 134       base_branch TEXT NOT NULL,
 135       repo_root   TEXT NOT NULL,
 136       status      TEXT NOT NULL,
 137       created_at  TEXT NOT NULL
 138     );
 139     ALTER TABLE sessions ADD COLUMN worktree_id TEXT;`,
 140    // v5 (Phase 3 / D33 action 1 + resolution (e)): the BYOK data layer.
 141    // provider_configs holds NON-SECRET connection metadata in plaintext —
 142    // base_url and extra_headers_json are documented non-secret (resolution e);
 143    // a credential's own envelope may override them, and the envelope wins.
 144    // credential_profiles holds the encrypted envelope plus plaintext metadata
 145    // that lets the UI list and disambiguate profiles WITHOUT decrypting.
 146    // REFERENCES here is ENFORCED (F16, re-verified 2026-07-22): deleting a
 147    // provider with profiles throws SQLITE_CONSTRAINT_FOREIGNKEY, so the
 148    // provider:delete handler must check first and refuse structurally.
 149    `CREATE TABLE provider_configs (
 150       id                 TEXT PRIMARY KEY,
 151       name               TEXT NOT NULL,
 152       adapter_type       TEXT NOT NULL,
 153       auth_mode          TEXT NOT NULL,
 154       env_var_name       TEXT,
 155       base_url           TEXT,
 156       extra_headers_json TEXT,
 157       created_at         TEXT NOT NULL
 158     );
 159     CREATE TABLE credential_profiles (
 160       id                TEXT PRIMARY KEY,
 161       provider_id       TEXT NOT NULL REFERENCES provider_configs(id),
 162       label             TEXT NOT NULL,
 163       encrypted_blob    BLOB NOT NULL,
 164       fingerprint_hash  TEXT NOT NULL,
 165       created_at        TEXT NOT NULL,
 166       last_verified_at  TEXT,
 167       unavailable_since TEXT,
 168       reencrypted_at    TEXT,
 169       UNIQUE (provider_id, label)
 170     );`,
 171    // v6 (Phase 3 / D48): the ROUTE carries its own default model. Nullable —
 172    // a subscription route has no model to name; existing rows read NULL. Same
 173    // shape as v3's `ALTER TABLE sessions ADD COLUMN title TEXT;`. Matches
 174    // schema.ts's `model: text('model')` exactly.
 175    `ALTER TABLE provider_configs ADD COLUMN model TEXT;`,
 176    // v7 (Phase 3a / Task 3a-1): the dispatch telemetry spine — Mission Control
 177    // spec §5.2 + §9 Phase 0. Historical actuals CANNOT be backfilled, which is
 178    // why this lands before any UI in this phase (D50).
 179    //
 180    // ⚠ NO `REFERENCES` CLAUSE ANYWHERE, AND THAT IS DELIBERATE. FKs are ENFORCED
 181    // on this database (F16). A dispatch outlives its session by design: pane
 182    // close DELETES the sessions row (D16 resolution d), and a restored session
 183    // is a genuinely FRESH conversation under the same id (Phase 8 open question
 184    // 1). A REFERENCES sessions(id) would default to RESTRICT and make the very
 185    // next pane close throw inside session:delete — a telemetry table that can
 186    // break a shipped user flow. session_id/project_id are OPAQUE STRINGS here.
 187    //
 188    // ⚠ tokens_*/cost_usd are declared now and written NULL by this task. Their
 189    // producer is Task 3a-3 (per-dispatch OpenRouter keys, D42). They live on
 190    // THIS row rather than in a separate `usage_records` table because they
 191    // describe the same run the wall-clock columns describe — one home, not two
 192    // (D48). The roadmap's `usage_records` name is superseded by this table.
 193    //
 194    // ⚠ attention_spans is created here and left EMPTY. Task 3a-2 is its only
 195    // writer. It exists in v7 so this phase's schema churn stays in ONE
 196    // migration rather than two.
 197    `CREATE TABLE dispatches (
 198       id            TEXT PRIMARY KEY,
 199       session_id    TEXT,
 200       project_id    TEXT,
 201       task_id       TEXT,
 202       agent         TEXT NOT NULL,
 203       model         TEXT,
 204       provider_name TEXT,
 205       auth_mode     TEXT NOT NULL,
 206       cwd           TEXT NOT NULL,
 207       started_at    TEXT NOT NULL,
 208       ended_at      TEXT,
 209       outcome       TEXT,
 210       closed_by     TEXT,
 211       exit_code     INTEGER,
 212       tokens_in     INTEGER,
 213       tokens_out    INTEGER,
 214       tokens_cached INTEGER,
 215       cost_usd      REAL
 216     );
 217     CREATE INDEX dispatches_open ON dispatches (outcome, session_id);
 218     CREATE TABLE attention_spans (
 219       id          TEXT PRIMARY KEY,
 220       dispatch_id TEXT,
 221       session_id  TEXT,
 222       project_id  TEXT,
 223       started_at  TEXT NOT NULL,
 224       ended_at    TEXT NOT NULL,
 225       seconds     INTEGER NOT NULL,
 226       class       TEXT NOT NULL,
 227       tick_seconds INTEGER NOT NULL,
 228       source      TEXT NOT NULL,
 229       created_at  TEXT NOT NULL
 230     );`,
 231    // v8 (Phase 3a / Task 3a-3, D42): the MINT LEDGER, added to 3a-1's
 232    // `dispatches` table rather than to a table of its own. A mint belongs to a
 233    // dispatch one-to-one; a second table would need a join, an enforced FK
 234    // (F16), and a duplicate orphan story — D48's anti-goal, and the easiest
 235    // moment in the phase to violate it. Same ALTER-in-place shape as v3
 236    // (sessions.title) and v6 (provider_configs.model): existing rows keep every
 237    // byte they had.
 238    //
 239    // ⚠ FIVE COLUMNS ARE NULLABLE AND ONE IS NOT, and the difference is
 240    // load-bearing rather than stylistic:
 241    //  - `revoked_at IS NULL` IS the definition of "this ledger row is OPEN" —
 242    //    the single predicate boot reconciliation queries. A default would make
 243    //    every pre-existing row look like an open, unrevoked mint.
 244    //  - `attribution_state` is NOT NULL DEFAULT 'none' because a row whose
 245    //    attribution state is unknown is a row nobody can reason about later,
 246    //    and 'none' is EXACTLY TRUE of every pre-v8 row: no attribution was
 247    //    attempted for any of them.
 248    //
 249    // The minted key itself is NEVER stored — not here, not in the vault, not
 250    // anywhere on disk. `minted_key_hash` is an identifier that cannot
 251    // authenticate (and is what the analytics api_key_id filter wants).
 252    `ALTER TABLE dispatches ADD COLUMN minted_key_hash TEXT;
 253     ALTER TABLE dispatches ADD COLUMN minted_key_limit REAL;
 254     ALTER TABLE dispatches ADD COLUMN minted_at TEXT;
 255     ALTER TABLE dispatches ADD COLUMN revoked_at TEXT;
 256     ALTER TABLE dispatches ADD COLUMN attribution_state TEXT NOT NULL DEFAULT 'none';
 257     ALTER TABLE dispatches ADD COLUMN tokens_source TEXT;
 258     CREATE INDEX dispatches_open_ledger ON dispatches (revoked_at, minted_key_hash);`,
 259    // v9 (Phase 3a / Task 3a-4): the model catalog — a CACHE of what a route
 260    // offers, and nothing more.
 261    //
 262    // ⚠ PRECEDENCE, NORMATIVE. Three artefacts talk about models, and exactly
 263    // ONE order resolves them for a launch:
 264    //     1. launch_profiles.model  — the choice for THIS launch    (Task 3a-5)
 265    //     2. provider_configs.model — this route's DEFAULT          (v6, D48)
 266    //     3. nothing                — the CLI's own default; no -m emitted
 267    //   model_catalog IS NOT IN THAT ORDER. It is a list of what exists. It is
 268    //   never authoritative over either other home, and it NEVER writes to
 269    //   them: no code path issues an UPDATE against provider_configs, and none
 270    //   may issue one against launch_profiles when that table exists. A catalog
 271    //   miss WARNS. It never blocks, clears, defaults, or substitutes — the
 272    //   provider is the authority on whether a model id resolves (F-36-4), and
 273    //   a stale cache used as a gate turns a warning into an outage.
 274    //   D48 exists because "which model" briefly had two homes. This table is
 275    //   how it gains a third ROLE without gaining a third AUTHORITY.
 276    //
 277    // ⚠ NO `REFERENCES` CLAUSE, DELIBERATELY. FKs are ENFORCED (F16), so
 278    // `REFERENCES provider_configs(id)` would default to RESTRICT and make the
 279    // first provider:delete after a refresh THROW — a cache breaking a user
 280    // flow that has worked since Task 3-4. `provider_id` is an OPAQUE STRING
 281    // here; StorageService.deleteProviderConfig purges a provider's catalog
 282    // rows explicitly, in the same transaction. Same reasoning as v7's
 283    // `dispatches` table (3a-1), reached independently.
 284    //
 285    // ⚠ NO `tier` COLUMN, though PLAN §13 names one. No provider response field
 286    // maps to it, so it could only hold a hardcoded classification of
 287    // third-party model names that would rot within weeks. Deliberate
 288    // deviation from PLAN §13; narrated in the commit message.
 289    //
 290    // ⚠ NO PRICING. A cached price is a number that is one day wrong in a way
 291    // that costs money. Task 3a-3 reads real spend from the provider instead.
 292    //
 293    // The composite PRIMARY KEY gives SQLite an implicit index that already
 294    // covers every read this task performs (`WHERE provider_id = ?`), so there
 295    // is NO separate index. Adding one for a query no consumer makes is the
 296    // same speculation the `tier` decision rejects.
 297    `CREATE TABLE model_catalog (
 298       provider_id    TEXT NOT NULL,
 299       model_id       TEXT NOT NULL,
 300       display_name   TEXT NOT NULL,
 301       context_length INTEGER,
 302       expires_at     TEXT,
 303       first_seen_at  TEXT NOT NULL,
 304       refreshed_at   TEXT NOT NULL,
 305       missing_since  TEXT,
 306       PRIMARY KEY (provider_id, model_id)
 307     );`,
 308    // v10 (Phase 3a / D43 + D49 + D53): launch_profiles — the (agent x route x
 309    // model) triple with an IMMUTABLE id and a RENAMEABLE label — plus the
 310    // per-session pointer that RETIRES Task 3-6's global `credentialed_sessions`
 311    // settings list. Four deliberate shapes:
 312    //
 313    //   1. ⚠ REFERENCES ON provider_id / credential_profile_id ARE ENFORCED
 314    //      (F16) AND INTENDED — the deliberate INVERSE of v7's `dispatches` and
 315    //      v9's `model_catalog`, both of which carry none. The difference is what
 316    //      the row IS:
 317    //
 318    //        dispatches / model_catalog | launch_profiles
 319    //        a historical FACT / cache  | a live INSTRUCTION
 320    //        still true if its subject   | A LIE once its subject is gone —
 321    //        is deleted                  | it cannot reproduce anything
 322    //        tolerate dangling           | RESTRICT, and refuse the delete
 323    //
 324    //      RESTRICT is correct here PRECISELY BECAUSE it forces the refusal to be
 325    //      authored in main: countLaunchProfilesForProvider /
 326    //      countLaunchProfilesForCredential run BEFORE the delete statement, so a
 327    //      user sees a sentence somebody wrote rather than a reverse-engineered
 328    //      SQLITE_CONSTRAINT_FOREIGNKEY (the failure Task 2-3 already paid for).
 329    //
 330    //   2. sessions.launch_profile_id carries NO REFERENCES — a SOFT pointer. A
 331    //      session row is history like a dispatch, and sessions are deleted on
 332    //      pane close (D16 resolution d); a FK here would make deleting a profile
 333    //      throw for every session that ever used it. Its dangling case is
 334    //      absorbed by the FAIL-SAFE predicate in launchProfiles.ts, which reads
 335    //      an unresolvable pointer as "credentialed" — because Chorus cannot
 336    //      PROVE such a session was keyless, and the only safe reading of "cannot
 337    //      prove" is "do not restore it keyless" (F26's failure shape).
 338    //
 339    //   3. UNIQUE(label): the label IS the picker, so duplicates are unusable.
 340    //      Checked in main before the insert; the constraint is the backstop.
 341    //
 342    //   4. ⚠ THE DATA MIGRATION SHIPS IN THE SAME ENTRY AS THE DDL, deliberately.
 343    //      Two versions would leave a window in which the settings row and the
 344    //      new column both exist and disagree. The runner applies each entry in
 345    //      ONE transaction (the v4 precedent: several statements, one entry).
 346    //
 347    // ⚠ THE DATA MIGRATION IS JSON1-FREE, AND THAT IS A CHOICE.
 348    // `WHERE id IN (SELECT value FROM json_each(...))` is more obviously correct
 349    // and is rejected anyway: it depends on the JSON1 extension being compiled
 350    // into the shipped better-sqlite3 build, and json_each on a MALFORMED value
 351    // THROWS — inside the runner's transaction, at boot, which fails the boot
 352    // outright. The LIKE form degrades to a no-op on any input it cannot
 353    // understand, which is the correct failure mode for a migration that runs
 354    // before the app is usable. COALESCE(..., '[]') makes it a no-op on a machine
 355    // that never had the row (a fresh install). The pattern matches the id WITH
 356    // its surrounding JSON quotes, so a partial-uuid collision is impossible, and
 357    // a uuid contains no LIKE wildcard (`%` or `_`) so no id can match another.
 358    `CREATE TABLE launch_profiles (
 359       id                    TEXT PRIMARY KEY,
 360       label                 TEXT NOT NULL UNIQUE,
 361       agent                 TEXT NOT NULL,
 362       provider_id           TEXT REFERENCES provider_configs(id),
 363       credential_profile_id TEXT REFERENCES credential_profiles(id),
 364       model                 TEXT,
 365       effort                TEXT,
 366       permission_mode       TEXT,
 367       workspace_mode        TEXT NOT NULL,
 368       env_json              TEXT,
 369       created_at            TEXT NOT NULL,
 370       updated_at            TEXT NOT NULL
 371     );
 372     ALTER TABLE sessions ADD COLUMN launch_profile_id TEXT;
 373     UPDATE sessions
 374        SET launch_profile_id = 'legacy-credentialed'
 375      WHERE COALESCE((SELECT value FROM settings WHERE key = 'credentialed_sessions'), '[]')
 376            LIKE '%"' || id || '"%';
 377     DELETE FROM settings WHERE key = 'credentialed_sessions';`,
 378    // v11 (Phase 3b / Task 3b-2, D62): the council's three tables — WHO its
 379    // members are, WHAT a run was, and WHAT WAS SAID. ONE atomic entry: the
 380    // runner applies each entry inside a transaction, so splitting these into
 381    // three versions would let a partial failure leave the schema half-built with
 382    // schema_migrations disagreeing about what exists.
 383    //
 384    // ⚠ 1. THE MEMBER STORES NO `base_url` AND NO `provider_id`, AND THAT IS THE
 385    //      WHOLE RULING. The roadmap's own Phase 3b line still describes a member
 386    //      as "credential profile + base URL + model id + role + params"; that
 387    //      phrasing PREDATES D48 and D56 and is superseded. `provider_configs`
 388    //      is the route's ONE home (D48) and `credential_profiles.provider_id`
 389    //      already points a credential at its route — so a `base_url` column here
 390    //      would rebuild, in a new table, precisely the second home D48 exists to
 391    //      prevent. There is no `provider_id` either: unlike `launch_profiles`,
 392    //      which needs both because D33 clause 9 makes a route-WITHOUT-credential
 393    //      first class, A COUNCIL MEMBER ALWAYS AUTHENTICATES. Storing both
 394    //      columns would create a class of row where they can disagree, and
 395    //      nothing would ever notice.
 396    //
 397    // ⚠ 2. THE FK RULING SPLITS THREE WAYS IN ONE MIGRATION, deliberately (D62).
 398    //      FKs are ENFORCED here (F16), so each choice has teeth:
 399    //
 400    //        council_members            | council_runs / council_messages
 401    //        a live INSTRUCTION         | a historical FACT
 402    //        real REFERENCES, RESTRICT  | NO REFERENCES AT ALL — soft pointers
 403    //        a member naming a deleted  | a transcript stays TRUE after its
 404    //        credential is a lie        | member is deleted
 405    //
 406    //      This is v10's `launch_profiles` ruling and v7/v9's `dispatches` /
 407    //      `model_catalog` ruling, reached in the same entry for different rows.
 408    //      Inverting either direction produces a distinct bug that surfaces
 409    //      identically as SQLITE_CONSTRAINT_FOREIGNKEY: put a FK on the message
 410    //      and deleting a member throws for every run it ever joined; drop the FK
 411    //      on the member and a member can outlive the credential it names.
 412    //
 413    //      RESTRICT is correct on the member PRECISELY BECAUSE it forces the
 414    //      refusal to be AUTHORED — countCouncilMembersForCredential runs BEFORE
 415    //      the delete statement, so the user reads a sentence somebody wrote
 416    //      rather than a reverse-engineered constraint error (the failure Task
 417    //      2-3 already paid for). The FK's job is to make the refusal MANDATORY,
 418    //      not to be the refusal.
 419    //
 420    //      Because SQLite will not cascade a soft pointer, deleteCouncilRun
 421    //      purges its own council_messages explicitly, in one transaction — the
 422    //      deleteProviderConfig -> model_catalog precedent.
 423    //
 424    // ⚠ 3. `model` IS NULLABLE AND RESOLVES BY D56, NEVER BACK-WRITTEN. Rank 1
 425    //      council_members.model (the choice for THIS member) > rank 2 the
 426    //      route's provider_configs.model (v6/D48) > rank 3 nothing emitted.
 427    //      Copying rank 2 into rank 1 is exactly how a second home gets created
 428    //      by accident, so nothing in this task issues an UPDATE that does it.
 429    //
 430    // ⚠ 4. NO `CHECK` ON `role`, and none on `params_json` either. The role
 431    //      vocabulary is validated by councilRoleSchema in MAIN, matching how
 432    //      `auth_mode` and `status` are handled everywhere else — a CHECK would
 433    //      put the vocabulary in two places and make widening it a MIGRATION.
 434    //
 435    // ⚠ 5. council_runs' four mint columns MIRROR v8's ledger exactly, including
 436    //      that `revoked_at IS NULL` IS the definition of an open ledger row —
 437    //      the predicate boot reconciliation queries, which is why it is nullable
 438    //      rather than defaulted. THE MINTED KEY ITSELF IS NEVER STORED;
 439    //      minted_key_hash is an identifier that cannot authenticate. D64(2)
 440    //      bounds a run to ONE minted key; Task 3b-3 is what mints it.
 441    //
 442    // ⚠ 6. council_messages.member_id IS NULLABLE — the synthesis and any
 443    //      orchestrator-authored framing have no member. `round` and `phase` are
 444    //      NOT NULL because a transcript row whose position in the deliberation
 445    //      is unknown cannot be rendered or reasoned about later, and there is no
 446    //      honest default for either.
 447    //
 448    // ⚠ THERE IS NO DATA MIGRATION. All three tables are created EMPTY, and
 449    // council_runs / council_messages get their FIRST WRITER in Task 3b-3 — the
 450    // `attention_spans` precedent (v7), where a table shipped one task before its
 451    // consumer so the phase's schema churn stays in ONE migration rather than
 452    // two. Nothing existing is read or rewritten here.
 453    `CREATE TABLE council_members (
 454       id                    TEXT PRIMARY KEY,
 455       label                 TEXT NOT NULL UNIQUE,
 456       credential_profile_id TEXT NOT NULL REFERENCES credential_profiles(id),
 457       model                 TEXT,
 458       role                  TEXT NOT NULL,
 459       params_json           TEXT,
 460       created_at            TEXT NOT NULL,
 461       updated_at            TEXT NOT NULL
 462     );
 463     CREATE TABLE council_runs (
 464       id               TEXT PRIMARY KEY,
 465       project_id       TEXT,
 466       brief_path       TEXT NOT NULL,
 467       findings_path    TEXT,
 468       status           TEXT NOT NULL,
 469       started_at       TEXT NOT NULL,
 470       ended_at         TEXT,
 471       minted_key_hash  TEXT,
 472       minted_key_limit REAL,
 473       minted_at        TEXT,
 474       revoked_at       TEXT,
 475       tokens_in        INTEGER,
 476       tokens_out       INTEGER,
 477       tokens_cached    INTEGER,
 478       cost_usd         REAL
 479     );
 480     CREATE TABLE council_messages (
 481       id         TEXT PRIMARY KEY,
 482       run_id     TEXT NOT NULL,
 483       member_id  TEXT,
 484       round      INTEGER NOT NULL,
 485       phase      TEXT NOT NULL,
 486       content    TEXT NOT NULL,
 487       tokens_in  INTEGER,
 488       tokens_out INTEGER,
 489       created_at TEXT NOT NULL
 490     );
 491     CREATE INDEX council_messages_run ON council_messages (run_id, round);`,
 492    // v12 (Phase 3d / Task 3d-2, D85): the user's model SHORTLIST. OpenRouter
 493    // alone returns ~340 models (measured on this machine, 2026-07-27); a launch
 494    // picker built on that number is not a picker. This records which handful the
 495    // user actually intends to use, per route.
 496    //
 497    // ⚠ A NEW TABLE RATHER THAN A COLUMN ON `model_catalog`, AND THE DISTINCTION
 498    // IS THE POINT. v9's catalog is a CACHE — written ONLY by `applyCatalogDiff`,
 499    // and D56 makes it explicitly never an authority over which model a launch
 500    // uses. This table holds the opposite kind of fact: USER INTENT, written only
 501    // by a click, which no refresh may ever touch. A `favourite` column on a cache
 502    // row would make one table mean two things, and the first person to tidy the
 503    // cache with a DELETE would destroy a curation built by hand.
 504    //
 505    // ⚠ AND NO FOREIGN KEY ONTO `model_catalog`, DELIBERATELY. A user must be able
 506    // to shortlist an id the catalog has never returned — the same freedom D48 and
 507    // D56 protect by keeping the route's default model a FREE-TEXT input with a
 508    // <datalist> attached rather than a closed <select>. A shortlist constrained
 509    // to ids a refresh happened to see would make the catalog authoritative BY
 510    // SCHEMA, which is precisely what those decisions exist to prevent. So a
 511    // shortlisted id survives the model going missing, survives the catalog being
 512    // emptied, and survives never having been in it at all.
 513    //
 514    // No REFERENCES to provider_configs either — v9's own reason: FKs are ENFORCED
 515    // (F16) and RESTRICT would make provider:delete throw. deleteProviderConfig
 516    // purges this table explicitly, in the same transaction it already purges
 517    // model_catalog in.
 518    `CREATE TABLE model_shortlist (
 519       provider_id TEXT NOT NULL,
 520       model_id    TEXT NOT NULL,
 521       added_at    TEXT NOT NULL,
 522       PRIMARY KEY (provider_id, model_id)
 523     );`,
 524    // v13: project IDENTITY — the name a project already had, plus the two facts
 525    // the rail and its settings screen need it to carry.
 526    //
 527    // ⚠ BOTH NULLABLE, AND `color` NULLABLE IS THE LOAD-BEARING PART. Until now
 528    // the rail derived a project's spine colour from its LIST INDEX, which meant
 529    // the colour was never stored anywhere and every existing row would have to
 530    // be back-filled to keep looking the way it looks today. NULL is read by the
 531    // rail as "no choice has been made — keep cycling the index", so pre-v13
 532    // projects render EXACTLY as they did before this migration, and a row gets a
 533    // stored colour the moment someone picks one (or the moment it is created,
 534    // which from here on assigns one).
 535    //
 536    // `description` is renderer-facing prose, capped at 1000 chars ON THE IPC
 537    // BOUNDARY rather than by a CHECK constraint: a length the user can hit by
 538    // typing belongs where it can be reported back to them as a counter, not
 539    // where it surfaces as a failed write.
 540    `ALTER TABLE projects ADD COLUMN color TEXT;
 541     ALTER TABLE projects ADD COLUMN description TEXT;`
 542  ]
 543  
 544  /**
 545   * SQLite-backed persistence, main process only. Nothing here crosses an IPC
 546   * boundary unvalidated: layout rows are re-parsed with the shared Zod schema
 547   * on read, so a hand-edited database cannot feed the renderer bad shapes.
 548   *
 549   * Query layer is Drizzle (D7) over the same better-sqlite3 connection that
 550   * the migration runner uses; Zod .parse() here is allowed (main process, D1).
 551   */
 552  export class StorageService {
 553    private db: Database.Database
 554    private d: BetterSQLite3Database<typeof schema>
 555  
 556    constructor(dbPath: string) {
 557      this.db = new Database(dbPath)
 558      this.db.pragma('journal_mode = WAL')
 559      this.d = drizzle(this.db, { schema })
 560      this.migrate()
 561    }
 562  
 563    /** Find the project for this root path, creating it on first run. */
 564    getOrCreateProject(rootPath: string): ProjectRecord {
 565      const existing = this.d.select().from(projects).where(eq(projects.rootPath, rootPath)).get()
 566      if (existing) return toProjectRecord(existing)
 567  
 568      // v13: a project created from here on gets a stored colour immediately,
 569      // cycling the palette by how many already exist — which is exactly the
 570      // rule the rail's old index cycle followed, now written down instead of
 571      // re-derived on every render. Pre-v13 rows keep `color` NULL and keep
 572      // rendering from the cycle, so nothing changes for them.
 573      const project: ProjectRecord = {
 574        id: randomUUID(),
 575        name: basename(rootPath),
 576        rootPath,
 577        color: defaultProjectColor(this.countProjects()),
 578        description: null
 579      }
 580      // Task 1-4: NO first-run seed. A new project has no pane_layouts row and
 581      // no session rows — sessions are created explicitly via the launch flow,
 582      // and the absent layout row is what shows the empty state. (Existing DBs
 583      // keep their seeded layout; this only affects DBs created from here on.)
 584      this.d
 585        .insert(projects)
 586        .values({
 587          id: project.id,
 588          name: project.name,
 589          rootPath,
 590          createdAt: new Date().toISOString(),
 591          color: project.color,
 592          description: null
 593        })
 594        .run()
 595      return project
 596    }
 597  
 598    /** All projects, in creation order (tab order). */
 599    listProjects(): ProjectRecord[] {
 600      return this.d.select().from(projects).orderBy(asc(projects.createdAt)).all().map(toProjectRecord)
 601    }
 602  
 603    /** How many projects exist — only ever asked so a new one can be handed the
 604     *  next colour in the palette cycle. */
 605    private countProjects(): number {
 606      return this.d.select({ n: count() }).from(projects).get()?.n ?? 0
 607    }
 608  
 609    /**
 610     * Task: project identity edits from the settings screen — name, colour and
 611     * description in ONE write, because that screen saves them together and a
 612     * partial save would leave the rail disagreeing with the form.
 613     *
 614     * Every field is required by the caller's schema (the renderer always sends
 615     * the full current state of the form), so this is a total overwrite rather
 616     * than a patch — there is no "leave this one alone" case to represent, and
 617     * inventing one would mean guessing which blank fields were cleared on
 618     * purpose.
 619     *
 620     * Returns the row as it now stands, so the caller reports what was actually
 621     * written rather than echoing what it asked for.
 622     */
 623    updateProject(
 624      id: string,
 625      fields: { name: string; color: string; description: string | null }
 626    ): ProjectRecord | null {
 627      this.d
 628        .update(projects)
 629        .set({ name: fields.name, color: fields.color, description: fields.description })
 630        .where(eq(projects.id, id))
 631        .run()
 632      return this.getProjectById(id)
 633    }
 634  
 635    /**
 636     * Session counts for EVERY project, in one `GROUP BY` (Task 3c-3 / D80).
 637     *
 638     * The project rail draws a session count on each item, and no per-project
 639     * round-trip is acceptable for that: N projects would mean N `layout:get`
 640     * calls at boot. This is one read, folded into the response `project:list`
 641     * already returns.
 642     *
 643     * Projects with no sessions are ABSENT from the map, not zero — the caller
 644     * defaults them, which keeps this a faithful report of what the table holds.
 645     */
 646    countSessionsByProject(): Map<string, number> {
 647      const rows = this.d
 648        .select({ projectId: sessions.projectId, n: count() })
 649        .from(sessions)
 650        .groupBy(sessions.projectId)
 651        .all()
 652      return new Map(rows.map((r) => [r.projectId, r.n]))
 653    }
 654  
 655    getProjectById(id: string): ProjectRecord | null {
 656      const row = this.d.select().from(projects).where(eq(projects.id, id)).get()
 657      return row ? toProjectRecord(row) : null
 658    }
 659  
 660    /** Active-project persistence (Task 1-5): inline-Drizzle settings pattern,
 661     *  same shape as getWindowBounds/saveWindowBounds. Null = never set — the
 662     *  boot sequence then seeds DEV_WORKING_DIR as the first-run default. */
 663    getActiveProjectId(): string | null {
 664      const row = this.d.select().from(settings).where(eq(settings.key, 'active_project_id')).get()
 665      return row?.value ?? null
 666    }
 667  
 668    setActiveProjectId(id: string): void {
 669      this.d
 670        .insert(settings)
 671        .values({ key: 'active_project_id', value: id })
 672        .onConflictDoUpdate({ target: settings.key, set: { value: id } })
 673        .run()
 674    }
 675  
 676    /**
 677     * Read the persisted layout as a versioned tree, or null when there is none.
 678     * Shapes handled:
 679     *  1. no row            -> null (fresh project, or the last pane was closed):
 680     *     the empty state. The ABSENCE of the row is the empty signal.
 681     *  2. valid tree v1     -> normalize (clamp ratios, dedupe keep-first), return
 682     *  3. legacy flat array (pre-1-2 content) -> lazy conversion: resolve or
 683     *     create the stable sessions rows, convert, WRITE THE TREE BACK, return
 684     *  4. anything else     -> log + treat as empty (never crash)
 685     */
 686    getPaneLayout(projectId: string): LayoutJson | null {
 687      const row = this.d.select().from(paneLayouts).where(eq(paneLayouts.projectId, projectId)).get()
 688      if (!row) return null
 689  
 690      let raw: unknown
 691      try {
 692        raw = JSON.parse(row.layoutJson)
 693      } catch {
 694        raw = undefined
 695      }
 696      if (raw !== undefined) {
 697        const asTree = layoutJsonSchema.safeParse(raw)
 698        if (asTree.success) {
 699          return { version: 1, root: normalizeTree(asTree.data.root) }
 700        }
 701        const asFlat = legacyFlatLayoutSchema.safeParse(raw)
 702        if (asFlat.success && asFlat.data.length > 0) {
 703          const layout = convertLegacyFlatLayout(
 704            asFlat.data,
 705            (agent) => this.findOrCreateSession(projectId, agent as AgentKind).id
 706          )
 707          this.savePaneLayout(projectId, layout)
 708          logger.info('[storage] converted legacy flat pane layout to layout tree v1')
 709          return layout
 710        }
 711      }
 712  
 713      logger.warn('[storage] pane_layouts.layout_json invalid; treating as empty layout')
 714      return null
 715    }
 716  
 717    /** Persist a layout tree (Task 1-3's layout:set path). Ratios are clamped
 718     *  on write as well as read. */
 719    savePaneLayout(projectId: string, layout: LayoutJson): void {
 720      const normalized: LayoutJson = { version: 1, root: normalizeTree(layout.root) }
 721      const layoutJson = JSON.stringify(normalized)
 722      this.d
 723        .insert(paneLayouts)
 724        .values({ projectId, layoutJson })
 725        .onConflictDoUpdate({ target: paneLayouts.projectId, set: { layoutJson } })
 726        .run()
 727    }
 728  
 729    /** Delete the pane_layouts row (Task 1-4 last-pane close): the empty-layout
 730     *  signal is the row's ABSENCE, never a null-root wrapper. */
 731    clearPaneLayout(projectId: string): void {
 732      this.d.delete(paneLayouts).where(eq(paneLayouts.projectId, projectId)).run()
 733    }
 734  
 735    /** Recent launch cwds, newest first. Non-string entries are filtered out on
 736     *  read so a hand-edited settings row cannot feed the renderer non-strings. */
 737    getRecentCwds(): string[] {
 738      const row = this.d.select().from(settings).where(eq(settings.key, 'recent_cwds')).get()
 739      if (!row) return []
 740      try {
 741        const arr: unknown = JSON.parse(row.value)
 742        return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
 743      } catch {
 744        return []
 745      }
 746    }
 747  
 748    /** Unshift + dedupe + cap at 10, mirroring the saveWindowBounds upsert pattern. */
 749    pushRecentCwd(cwd: string): void {
 750      const next = [cwd, ...this.getRecentCwds().filter((x) => x !== cwd)].slice(0, 10)
 751      const value = JSON.stringify(next)
 752      this.d
 753        .insert(settings)
 754        .values({ key: 'recent_cwds', value })
 755        .onConflictDoUpdate({ target: settings.key, set: { value } })
 756        .run()
 757    }
 758  
 759    /* -------------------------------------------------------------------- */
 760    /* Task 3a-5 / D49: which session rows launched on a stored credential.   */
 761    /*                                                                        */
 762    /* ⚠ THIS REPLACES Task 3-6's global `credentialed_sessions` settings      */
 763    /* list, which was an explicitly-labelled PHASE-3-ONLY EXPEDIENT. The     */
 764    /* fact is now DERIVED from the launch profile a session ran under —      */
 765    /* per-session, and therefore per-project, which is the whole debt        */
 766    /* retirement. `markSessionCredentialed` / `unmarkSessionCredentialed` /  */
 767    /* `writeCredentialedSessionIds` are GONE: the fact is written on the     */
 768    /* session's own INSERT and dies with the row, structurally, so there is  */
 769    /* no window in which a crash leaves a credentialed session unmarked.     */
 770    /*                                                                        */
 771    /* Every policy decision lives in launchProfiles.ts. This is lookup only. */
 772    /* -------------------------------------------------------------------- */
 773  
 774    /**
 775     * Restore's input. ⚠ NOTE THE PARAMETER: the 3-6 form was global over all
 776     * projects; it is now scoped, which is the retirement made visible in the
 777     * signature. Fail-safe semantics live in `sessionIsCredentialed`.
 778     */
 779    getCredentialedSessionIds(projectId: string): Set<string> {
 780      const rows = this.d
 781        .select({ id: sessions.id, launchProfileId: sessions.launchProfileId })
 782        .from(sessions)
 783        .where(and(eq(sessions.projectId, projectId), isNotNull(sessions.launchProfileId)))
 784        .all()
 785      const out = new Set<string>()
 786      for (const row of rows) {
 787        if (sessionIsCredentialed(row.launchProfileId, (id) => this.getLaunchProfileById(id) ?? undefined)) {
 788          out.add(row.id)
 789        }
 790      }
 791      return out
 792    }
 793  
 794    /** session:restart's input — the same predicate for one row. */
 795    isSessionCredentialed(sessionId: string): boolean {
 796      const row = this.d
 797        .select({ launchProfileId: sessions.launchProfileId })
 798        .from(sessions)
 799        .where(eq(sessions.id, sessionId))
 800        .get()
 801      if (!row) return false
 802      return sessionIsCredentialed(row.launchProfileId, (id) => this.getLaunchProfileById(id) ?? undefined)
 803    }
 804  
 805    createSession(row: NewSessionRow): SessionRow {
 806      this.d.insert(sessions).values(row).run()
 807      return {
 808        ...row,
 809        exitCode: row.exitCode ?? null,
 810        title: row.title ?? null,
 811        worktreeId: row.worktreeId ?? null,
 812        // v10: written on the SAME insert as the row, never in a follow-up
 813        // update — a crash between the two would leave a credentialed session
 814        // unmarked, which is the silent-keyless-restore failure through the back
 815        // door. The caller passes it in `row`; this only normalizes the default.
 816        launchProfileId: row.launchProfileId ?? null
 817      }
 818    }
 819  
 820    getSessionsForProject(projectId: string): SessionRow[] {
 821      return this.d
 822        .select()
 823        .from(sessions)
 824        .where(eq(sessions.projectId, projectId))
 825        .orderBy(asc(sessions.createdAt))
 826        .all()
 827    }
 828  
 829    /** Single session row by id (session:restart reads it without a project
 830     *  context; the row itself carries project_id). */
 831    getSessionById(id: string): SessionRow | null {
 832      return this.d.select().from(sessions).where(eq(sessions.id, id)).get() ?? null
 833    }
 834  
 835    /** Delete a session row (Task 1-5 close flow). The IPC layer refuses to call
 836     *  this for a session that is live in the manager. */
 837    deleteSession(id: string): void {
 838      this.d.delete(sessions).where(eq(sessions.id, id)).run()
 839    }
 840  
 841    updateSessionStatus(id: string, status: SessionStatus, exitCode?: number | null): void {
 842      this.d
 843        .update(sessions)
 844        .set(exitCode === undefined ? { status } : { status, exitCode })
 845        .where(eq(sessions.id, id))
 846        .run()
 847    }
 848  
 849    /** Persist a captured title (session:set-title). Sanitization happens in the
 850     *  IPC handler; a missing id is a zero-row no-op, matching updateSessionStatus. */
 851    updateSessionTitle(id: string, title: string): void {
 852      this.d.update(sessions).set({ title }).where(eq(sessions.id, id)).run()
 853    }
 854  
 855    /* -------------------------------------------------------------------- */
 856    /* Worktrees (Phase 2 / D26). The two pointer-writing ops are            */
 857    /* transactional per resolution (a): worktrees.session_id AND            */
 858    /* sessions.worktree_id move in ONE synchronous transaction.             */
 859    /* -------------------------------------------------------------------- */
 860  
 861    createWorktreeRow(row: NewWorktreeRow): WorktreeRow {
 862      this.d.insert(worktrees).values(row).run()
 863      return { ...row, sessionId: row.sessionId ?? null } as WorktreeRow
 864    }
 865  
 866    /** The 2-3 retained-worktree panel's data source, in creation order. */
 867    getWorktreesForProject(projectId: string): WorktreeRow[] {
 868      return this.d
 869        .select()
 870        .from(worktrees)
 871        .where(eq(worktrees.projectId, projectId))
 872        .orderBy(asc(worktrees.createdAt))
 873        .all()
 874    }
 875  
 876    /** Every worktree row — the boot reconcile's input (Task 2-1). */
 877    getAllWorktrees(): WorktreeRow[] {
 878      return this.d.select().from(worktrees).all()
 879    }
 880  
 881    getWorktreeById(id: string): WorktreeRow | null {
 882      return this.d.select().from(worktrees).where(eq(worktrees.id, id)).get() ?? null
 883    }
 884  
 885    updateWorktreeStatus(id: string, status: string): void {
 886      this.d.update(worktrees).set({ status }).where(eq(worktrees.id, id)).run()
 887    }
 888  
 889    /** Resolution (a): both pointers + status='active' + session cwd → worktree
 890     *  path, in ONE synchronous transaction. Called by 2-2's new-worktree launch. */
 891    activateWorktreeForSession(worktreeId: string, sessionId: string, worktreePath: string): void {
 892      this.d.transaction((tx) => {
 893        tx.update(worktrees).set({ sessionId, status: 'active' }).where(eq(worktrees.id, worktreeId)).run()
 894        tx.update(sessions).set({ worktreeId, cwd: worktreePath }).where(eq(sessions.id, sessionId)).run()
 895      })
 896    }
 897  
 898    /** Resolution (a): clear both pointers + status='detached', one transaction.
 899     *  Called by 2-3's close flow / session:delete. */
 900    detachWorktree(worktreeId: string): void {
 901      this.d.transaction((tx) => {
 902        const wt = tx.select().from(worktrees).where(eq(worktrees.id, worktreeId)).get()
 903        tx.update(worktrees).set({ sessionId: null, status: 'detached' }).where(eq(worktrees.id, worktreeId)).run()
 904        if (wt?.sessionId) tx.update(sessions).set({ worktreeId: null }).where(eq(sessions.id, wt.sessionId)).run()
 905      })
 906    }
 907  
 908    /** Row removal is only ever reconcile's provably-nothing-durable case
 909     *  (P3c/P3e) or the successful end of removeWorktree — never a dirty tree. */
 910    deleteWorktreeRow(id: string): void {
 911      this.d.delete(worktrees).where(eq(worktrees.id, id)).run()
 912    }
 913  
 914    /* -------------------------------------------------------------------- */
 915    /* Providers + credential profiles (Phase 3 / D33). Rows in, rows out — */
 916    /* every policy decision (encrypt, refuse, classify) lives in the vault */
 917    /* and the IPC handlers; nothing here touches a plaintext key.          */
 918    /* -------------------------------------------------------------------- */
 919  
 920    createProviderConfig(row: NewProviderConfigRow): ProviderConfigRow {
 921      this.d.insert(providerConfigs).values(row).run()
 922      return {
 923        ...row,
 924        envVarName: row.envVarName ?? null,
 925        baseUrl: row.baseUrl ?? null,
 926        extraHeadersJson: row.extraHeadersJson ?? null,
 927        model: row.model ?? null
 928      }
 929    }
 930  
 931    listProviderConfigs(): ProviderConfigRow[] {
 932      return this.d.select().from(providerConfigs).orderBy(asc(providerConfigs.createdAt)).all()
 933    }
 934  
 935    getProviderConfigById(id: string): ProviderConfigRow | null {
 936      return this.d.select().from(providerConfigs).where(eq(providerConfigs.id, id)).get() ?? null
 937    }
 938  
 939    /** Patch semantics are the handler's: only the fields it includes are set. */
 940    updateProviderConfig(id: string, patch: Partial<Omit<NewProviderConfigRow, 'id' | 'createdAt'>>): void {
 941      this.d.update(providerConfigs).set(patch).where(eq(providerConfigs.id, id)).run()
 942    }
 943  
 944    /** F16: this THROWS SQLITE_CONSTRAINT_FOREIGNKEY while any credential
 945     *  profile references the provider — callers must count-and-refuse first
 946     *  (countCredentialProfilesForProvider), never reverse-engineer the throw.
 947     *
 948     *  Task 3a-4: the provider's model_catalog rows are purged in the SAME
 949     *  transaction, BEFORE the provider row. model_catalog carries no
 950     *  REFERENCES clause deliberately (FKs are ENFORCED — F16 — and RESTRICT
 951     *  would make this delete throw for a table that is a cache), so the purge
 952     *  is explicit rather than a cascade. An orphaned cache row is harmless but
 953     *  untrue, and the purge costs one statement.
 954     *
 955     *  ⚠ The count-and-refuse on credential profiles is UNCHANGED and stays
 956     *  with the caller: profiles still block a delete; a catalog never does. A
 957     *  cache is not a reason to keep a route the user asked to remove. */
 958    deleteProviderConfig(id: string): void {
 959      this.d.transaction((tx) => {
 960        tx.delete(modelCatalog).where(eq(modelCatalog.providerId, id)).run()
 961        // v12/D85: the shortlist is soft-pointed at the provider for the same
 962        // reason the catalog is (FKs are ENFORCED, F16, and RESTRICT would make
 963        // this delete throw), so it is purged HERE, in the same transaction. A
 964        // provider that is gone cannot leave a curation behind that nothing can
 965        // ever reach or delete.
 966        tx.delete(modelShortlist).where(eq(modelShortlist.providerId, id)).run()
 967        tx.delete(providerConfigs).where(eq(providerConfigs.id, id)).run()
 968      })
 969    }
 970  
 971    createCredentialProfile(row: NewCredentialProfileRow): CredentialProfileRow {
 972      this.d.insert(credentialProfiles).values(row).run()
 973      return {
 974        ...row,
 975        lastVerifiedAt: row.lastVerifiedAt ?? null,
 976        unavailableSince: row.unavailableSince ?? null,
 977        reencryptedAt: row.reencryptedAt ?? null
 978      }
 979    }
 980  
 981    listCredentialProfiles(): CredentialProfileRow[] {
 982      return this.d.select().from(credentialProfiles).orderBy(asc(credentialProfiles.createdAt)).all()
 983    }
 984  
 985    getCredentialProfileById(id: string): CredentialProfileRow | null {
 986      return this.d.select().from(credentialProfiles).where(eq(credentialProfiles.id, id)).get() ?? null
 987    }
 988  
 989    /** D33 resolution (b): main-side duplicate detection, scoped to one
 990     *  provider — the same key on two different providers is legitimate. */
 991    getCredentialProfileByFingerprint(
 992      providerId: string,
 993      fingerprintHash: string
 994    ): CredentialProfileRow | null {
 995      return (
 996        this.d
 997          .select()
 998          .from(credentialProfiles)
 999          .where(
1000            and(
1001              eq(credentialProfiles.providerId, providerId),
1002              eq(credentialProfiles.fingerprintHash, fingerprintHash)
1003            )
1004          )
1005          .get() ?? null
1006      )
1007    }
1008  
1009    /** The provider:delete pre-check (F16): refuse while this is non-zero. */
1010    countCredentialProfilesForProvider(providerId: string): number {
1011      return (
1012        this.d
1013          .select({ n: count() })
1014          .from(credentialProfiles)
1015          .where(eq(credentialProfiles.providerId, providerId))
1016          .get()?.n ?? 0
1017      )
1018    }
1019  
1020    /** The successful-replace / re-encrypt write: new blob + fingerprint, and
1021     *  clears unavailable_since — D33 clause 8: the mark survives until a
1022     *  successful replace clears it. */
1023    updateCredentialBlob(id: string, blob: Buffer, fingerprintHash: string): void {
1024      this.d
1025        .update(credentialProfiles)
1026        .set({ encryptedBlob: blob, fingerprintHash, unavailableSince: null })
1027        .where(eq(credentialProfiles.id, id))
1028        .run()
1029    }
1030  
1031    /** D33 clause 8: set on decrypt failure. The row is KEPT. */
1032    markCredentialUnavailable(id: string, at: string): void {
1033      this.d.update(credentialProfiles).set({ unavailableSince: at }).where(eq(credentialProfiles.id, id)).run()
1034    }
1035  
1036    /** D33 risk 7 throttle marker for the shouldReEncrypt path. */
1037    markCredentialReencrypted(id: string, at: string): void {
1038      this.d.update(credentialProfiles).set({ reencryptedAt: at }).where(eq(credentialProfiles.id, id)).run()
1039    }
1040  
1041    /** Written by Task 3-6's test-key probe only — no writer exists yet.
1042     *
1043     *  ⚠ Task 3a-4 deliberately does NOT call this. A successful model refresh
1044     *  is not evidence of authentication: OpenRouter's /models answers 200 with
1045     *  no credential at all (D4-re-verified 2026-07-25). A refresh is not a Test
1046     *  key and must not pretend to be. */
1047    markCredentialVerified(id: string, at: string): void {
1048      this.d.update(credentialProfiles).set({ lastVerifiedAt: at }).where(eq(credentialProfiles.id, id)).run()
1049    }
1050  
1051    deleteCredentialProfile(id: string): void {
1052      this.d.delete(credentialProfiles).where(eq(credentialProfiles.id, id)).run()
1053    }
1054  
1055    /* -------------------------------------------------------------------- */
1056    /* Model catalog (Phase 3a / Task 3a-4, migration v9). Rows in, rows out. */
1057    /* EVERY POLICY DECISION LIVES IN modelCatalogCore.ts — these are dumb.  */
1058    /*                                                                       */
1059    /* ⚠ Nothing in this section writes provider_configs. The catalog is a   */
1060    /* list of what exists, never an authority over the route's default      */
1061    /* model; a catalog miss warns and never clears, defaults or substitutes. */
1062    /* -------------------------------------------------------------------- */
1063  
1064    /** All catalog rows for one provider, MISSING ONES INCLUDED — they still
1065     *  render, struck through, because deleting them would destroy the only
1066     *  evidence the id was ever real. Ordered by display_name for stable UI. */
1067    getModelCatalogForProvider(providerId: string): ModelCatalogRow[] {
1068      return this.d
1069        .select()
1070        .from(modelCatalog)
1071        .where(eq(modelCatalog.providerId, providerId))
1072        .orderBy(asc(modelCatalog.displayName))
1073        .all()
1074    }
1075  
1076    /** The newest refreshed_at across a provider's rows, or null when the
1077     *  provider has never been refreshed. THE freshness fact — there is no
1078     *  per-provider freshness column, because that would be a second home for
1079     *  one fact (D48's lesson, applied to a cache). */
1080    getCatalogRefreshedAt(providerId: string): string | null {
1081      return (
1082        this.d
1083          .select({ v: max(modelCatalog.refreshedAt) })
1084          .from(modelCatalog)
1085          .where(eq(modelCatalog.providerId, providerId))
1086          .get()?.v ?? null
1087      )
1088    }
1089  
1090    /**
1091     * Apply one refresh's computed diff ATOMICALLY. Takes the core's output and
1092     * makes no decisions of its own.
1093     *
1094     * ⚠ The upsert's UPDATE branch deliberately omits `first_seen_at` and
1095     * `missing_since`. Omitting the first is what preserves the audit fact;
1096     * omitting the second is what keeps "missing since" from being rewritten by
1097     * a refresh that merely saw the model again — that clearing is an explicit,
1098     * counted instruction (`clearMissing`), not a side effect.
1099     *
1100     * The composite PK is what makes a second refresh UPDATE rather than
1101     * duplicate — the bug that only appears on the second button press.
1102     */
1103    applyCatalogDiff(providerId: string, diff: CatalogDiff): void {
1104      this.d.transaction((tx) => {
1105        for (const m of diff.upserts) {
1106          tx.insert(modelCatalog)
1107            .values({
1108              providerId,
1109              modelId: m.modelId,
1110              displayName: m.displayName,
1111              contextLength: m.contextLength,
1112              expiresAt: m.expiresAt,
1113              firstSeenAt: m.firstSeenAt,
1114              refreshedAt: m.refreshedAt,
1115              missingSince: null
1116            })
1117            .onConflictDoUpdate({
1118              target: [modelCatalog.providerId, modelCatalog.modelId],
1119              set: {
1120                displayName: m.displayName,
1121                contextLength: m.contextLength,
1122                expiresAt: m.expiresAt,
1123                refreshedAt: m.refreshedAt
1124              }
1125            })
1126            .run()
1127        }
1128        for (const id of diff.markMissing) {
1129          tx.update(modelCatalog)
1130            .set({ missingSince: diff.nowIso })
1131            .where(and(eq(modelCatalog.providerId, providerId), eq(modelCatalog.modelId, id)))
1132            .run()
1133        }
1134        for (const id of diff.clearMissing) {
1135          tx.update(modelCatalog)
1136            .set({ missingSince: null })
1137            .where(and(eq(modelCatalog.providerId, providerId), eq(modelCatalog.modelId, id)))
1138            .run()
1139        }
1140      })
1141    }
1142  
1143    /** Used ONLY by deleteProviderConfig's purge and by the verification
1144     *  harness. Not exposed over IPC. */
1145    deleteModelCatalogForProvider(providerId: string): void {
1146      this.d.delete(modelCatalog).where(eq(modelCatalog.providerId, providerId)).run()
1147    }
1148  
1149    /* -------------------------------------------------------------------- */
1150    /* v12 / D85: the model SHORTLIST — user intent, not cache.             */
1151    /*                                                                      */
1152    /* ⚠ NOTHING IN THIS SECTION IS CALLED BY A REFRESH, and nothing in the  */
1153    /* catalog section above touches `model_shortlist`. That separation is   */
1154    /* the decision, not an accident of layout: the moment a refresh can     */
1155    /* write here, a provider's response can silently edit a list the user   */
1156    /* built by hand. Grep `applyCatalogDiff` for `modelShortlist`: zero.    */
1157    /* -------------------------------------------------------------------- */
1158  
1159    /** One provider's shortlisted model ids, IN THE ORDER THE USER BUILT THEM.
1160     *  Deliberately not alphabetical: a personal shortlist carries information
1161     *  in its order that the alphabet destroys. */
1162    getModelShortlistForProvider(providerId: string): ModelShortlistRow[] {
1163      return this.d
1164        .select()
1165        .from(modelShortlist)
1166        .where(eq(modelShortlist.providerId, providerId))
1167        .orderBy(asc(modelShortlist.addedAt))
1168        .all()
1169    }
1170  
1171    /**
1172     * Add or remove one id. IDEMPOTENT in both directions — adding twice is not
1173     * an error and does not move `added_at` (the composite PK makes the second
1174     * insert a no-op rather than a duplicate, and `DO NOTHING` is what keeps the
1175     * original ordering fact intact). Removing something absent is a no-op too.
1176     *
1177     * ⚠ THE ID IS NOT CHECKED AGAINST `model_catalog`, DELIBERATELY. See the v12
1178     * migration comment: a shortlist that could only hold ids a refresh returned
1179     * would make the catalog authoritative by construction.
1180     */
1181    setModelShortlisted(providerId: string, modelId: string, shortlisted: boolean, nowIso: string): void {
1182      if (shortlisted) {
1183        this.d
1184          .insert(modelShortlist)
1185          .values({ providerId, modelId, addedAt: nowIso })
1186          .onConflictDoNothing({ target: [modelShortlist.providerId, modelShortlist.modelId] })
1187          .run()
1188        return
1189      }
1190      this.d
1191        .delete(modelShortlist)
1192        .where(and(eq(modelShortlist.providerId, providerId), eq(modelShortlist.modelId, modelId)))
1193        .run()
1194    }
1195  
1196    /* -------------------------------------------------------------------- */
1197    /* Dispatch telemetry (Phase 3a / Task 3a-1, migration v7). Rows in,     */
1198    /* rows out. "OPEN" means outcome IS NULL — never ended_at IS NULL, which */
1199    /* a boot-healed orphan deliberately leaves set to NULL forever.         */
1200    /* -------------------------------------------------------------------- */
1201  
1202    createDispatch(row: NewDispatchRow): DispatchRow {
1203      this.d.insert(dispatches).values(row).run()
1204      return {
1205        ...row,
1206        sessionId: row.sessionId ?? null,
1207        projectId: row.projectId ?? null,
1208        taskId: row.taskId ?? null,
1209        model: row.model ?? null,
1210        providerName: row.providerName ?? null,
1211        endedAt: row.endedAt ?? null,
1212        outcome: row.outcome ?? null,
1213        closedBy: row.closedBy ?? null,
1214        exitCode: row.exitCode ?? null,
1215        tokensIn: row.tokensIn ?? null,
1216        tokensOut: row.tokensOut ?? null,
1217        tokensCached: row.tokensCached ?? null,
1218        costUsd: row.costUsd ?? null,
1219        // v8 (3a-3): a freshly opened dispatch has no mint yet. 'none' is the
1220        // DDL default and is exactly true at this moment — attachMintedKey
1221        // promotes it to 'minted' only once a key really exists.
1222        mintedKeyHash: row.mintedKeyHash ?? null,
1223        mintedKeyLimit: row.mintedKeyLimit ?? null,
1224        mintedAt: row.mintedAt ?? null,
1225        revokedAt: row.revokedAt ?? null,
1226        attributionState: row.attributionState ?? 'none',
1227        tokensSource: row.tokensSource ?? null
1228      }
1229    }
1230  
1231    /** The open dispatch for a session, newest first. Used by the exit close.
1232     *  Returns null when there is none — a normal case, not an error (a session
1233     *  spawned before this feature existed, or a dispatch already closed). */
1234    getOpenDispatchForSession(sessionId: string): DispatchRow | null {
1235      return (
1236        this.d
1237          .select()
1238          .from(dispatches)
1239          .where(and(eq(dispatches.sessionId, sessionId), isNull(dispatches.outcome)))
1240          .orderBy(desc(dispatches.startedAt))
1241          .get() ?? null
1242      )
1243    }
1244  
1245    /** The most recent dispatch for a session REGARDLESS of outcome (Task 3a-3).
1246     *  Distinct from getOpenDispatchForSession on purpose: attribution settles on
1247     *  the same `onExit` event 3a-1's recorder closes the row on, and listener
1248     *  order within the Set is explicitly not contractual — so by the time this
1249     *  runs the row may already carry an outcome and be invisible to the "open"
1250     *  query. Enriching a just-closed row is correct; missing it is not. */
1251    getLatestDispatchForSession(sessionId: string): DispatchRow | null {
1252      return (
1253        this.d
1254          .select()
1255          .from(dispatches)
1256          .where(eq(dispatches.sessionId, sessionId))
1257          .orderBy(desc(dispatches.startedAt))
1258          .get() ?? null
1259      )
1260    }
1261  
1262    /** Every dispatch still open — the boot heal's input. */
1263    listOpenDispatches(): DispatchRow[] {
1264      return this.d.select().from(dispatches).where(isNull(dispatches.outcome)).all()
1265    }
1266  
1267    /** The ONE close path. `endedAt` is nullable so the boot heal can record
1268     *  "it ended, we never saw when". Writes nothing if the row already carries
1269     *  an outcome (idempotence is enforced HERE, in the WHERE clause, so a
1270     *  caller that loops cannot rewrite history). */
1271    closeDispatch(
1272      id: string,
1273      patch: {
1274        outcome: 'completed' | 'abandoned' | 'failed'
1275        closedBy: 'exit' | 'kill' | 'dispose' | 'boot-heal'
1276        endedAt: string | null
1277        exitCode: number | null
1278      }
1279    ): void {
1280      this.d
1281        .update(dispatches)
1282        .set(patch)
1283        .where(and(eq(dispatches.id, id), isNull(dispatches.outcome)))
1284        .run()
1285    }
1286  
1287    /* -------------------------------------------------------------------- */
1288    /* Mint ledger + token/cost fill (Phase 3a / Task 3a-3, migration v8).    */
1289    /*                                                                        */
1290    /* ⚠ EVERY ACCESSOR HERE IS AN `UPDATE`, NEVER AN `INSERT`. 3a-1's        */
1291    /* DispatchRecorder owns row lifecycle; this task only ENRICHES a row     */
1292    /* that already exists, and no accessor below touches `outcome`,          */
1293    /* `ended_at`, `agent`, `model` or `auth_mode` — two writers on one row   */
1294    /* is how a close gets silently undone.                                   */
1295    /*                                                                        */
1296    /* Idempotence lives in the WHERE clause, as it does in closeDispatch,    */
1297    /* so a caller that loops cannot rewrite history.                         */
1298    /* -------------------------------------------------------------------- */
1299  
1300    /** The write-ahead ledger write: record that a key was minted for this
1301     *  dispatch, BEFORE anything spends under it. `revoked_at` stays NULL, which
1302     *  is what makes this row visible to boot reconciliation. */
1303    attachMintedKey(
1304      dispatchId: string,
1305      ledger: { hash: string; limit: number | null; mintedAt: string }
1306    ): void {
1307      this.d
1308        .update(dispatches)
1309        .set({
1310          mintedKeyHash: ledger.hash,
1311          mintedKeyLimit: ledger.limit,
1312          mintedAt: ledger.mintedAt,
1313          attributionState: 'minted'
1314        })
1315        .where(and(eq(dispatches.id, dispatchId), isNull(dispatches.mintedKeyHash)))
1316        .run()
1317    }
1318  
1319    /** Record an attribution outcome that never involved a minted key —
1320     *  'mint-failed', 'cli-logs' or 'none'. Deliberately separate from
1321     *  attachMintedKey so a mint failure cannot half-write a ledger. */
1322    setAttributionState(dispatchId: string, state: string): void {
1323      this.d.update(dispatches).set({ attributionState: state }).where(eq(dispatches.id, dispatchId)).run()
1324    }
1325  
1326    /**
1327     * ⚠ THE BOOT RECONCILE'S INPUT: every OPEN ledger row, ACROSS BOTH TABLES.
1328     * "Open" is `revoked_at IS NULL` AND a hash present — never `outcome IS NULL`,
1329     * which is 3a-1's separate notion of an open DISPATCH. The two are different
1330     * questions and conflating them is how a live dispatch's key gets revoked.
1331     *
1332     * ⚠ D66: `council_runs` (v11) carries the same four mint columns and the same
1333     * open-row predicate as `dispatches` (v8), deliberately — and until this
1334     * commit NONE of them was read, so a council key had no backstop whatsoever.
1335     * The two selects are unioned HERE rather than reconciled separately, because
1336     * D66(a) rules that exactly one place may decide whether a key is ours.
1337     *
1338     * The rows are TAGGED. `attributionCore.OpenLedgerRow` is discriminated by
1339     * kind, and the tag is what stops a run id reaching a `dispatches` UPDATE.
1340     */
1341    listOpenMintLedger(): (
1342      | { kind: 'dispatch'; dispatchId: string; hash: string }
1343      | { kind: 'council'; runId: string; hash: string }
1344    )[] {
1345      const dispatchRows = this.d
1346        .select({ dispatchId: dispatches.id, hash: dispatches.mintedKeyHash })
1347        .from(dispatches)
1348        .where(and(isNull(dispatches.revokedAt), isNotNull(dispatches.mintedKeyHash)))
1349        .all()
1350        .filter((r): r is { dispatchId: string; hash: string } => typeof r.hash === 'string')
1351        .map((r) => ({ kind: 'dispatch' as const, dispatchId: r.dispatchId, hash: r.hash }))
1352      const councilRows = this.d
1353        .select({ runId: councilRuns.id, hash: councilRuns.mintedKeyHash })
1354        .from(councilRuns)
1355        .where(and(isNull(councilRuns.revokedAt), isNotNull(councilRuns.mintedKeyHash)))
1356        .all()
1357        .filter((r): r is { runId: string; hash: string } => typeof r.hash === 'string')
1358        .map((r) => ({ kind: 'council' as const, runId: r.runId, hash: r.hash }))
1359      return [...dispatchRows, ...councilRows]
1360    }
1361  
1362    /** Dispatch ids still RUNNING — the classifier's "does a live dispatch own
1363     *  this key?" input. Read AFTER 3a-1's healOrphansAtBoot has closed the rows
1364     *  a crash left open, or every orphan reads as running (§6.2). */
1365    getRunningDispatchIds(): Set<string> {
1366      return new Set(
1367        this.d
1368          .select({ id: dispatches.id })
1369          .from(dispatches)
1370          .where(isNull(dispatches.outcome))
1371          .all()
1372          .map((r) => r.id)
1373      )
1374    }
1375  
1376    /** The council half of the same question (D66). Read AFTER
1377     *  `healOpenCouncilRunsAtBoot()`, for the identical reason — the two together
1378     *  are one ordering constraint, inherited whole. */
1379    getRunningCouncilRunIds(): Set<string> {
1380      return new Set(
1381        this.d
1382          .select({ id: councilRuns.id })
1383          .from(councilRuns)
1384          .where(eq(councilRuns.status, COUNCIL_RUN_RUNNING))
1385          .all()
1386          .map((r) => r.id)
1387      )
1388    }
1389  
1390    /**
1391     * ⚠ THE COUNCIL HALF OF THE BOOT HEAL (D66(d)), and its position is
1392     * LOAD-BEARING: it runs BEFORE `reconcileOrphanedKeys`, beside
1393     * `dispatches.healOrphansAtBoot()`. Run the reconcile first and a crashed run
1394     * still reads as RUNNING, so matrix row 2 fires, row 1 never does, and the
1395     * reconcile appears to work while doing nothing on exactly the rows it exists
1396     * for.
1397     *
1398     * It is trivially correct because of D63 Q2: a council member never enters
1399     * `SessionManager` and writes no `sessions` row, so the restore engine
1400     * structurally CANNOT resurrect a run — every `council_runs` row still open at
1401     * boot belongs to a run that is already over. Same reasoning as
1402     * `healOrphansAtBoot` one layer up, and as F6's "persisted 'running' means WAS
1403     * running when last observed".
1404     *
1405     * `ended_at` stays NULL on purpose, exactly as the dispatch heal leaves it:
1406     * this run ended and nobody observed when. Inventing a plausible end time at
1407     * boot is the confident-looking number D55 exists to forbid.
1408     *
1409     * Returns the ids it healed so the caller can log them individually — a heal
1410     * that did nothing and a heal that is broken look identical otherwise.
1411     */
1412    healOpenCouncilRunsAtBoot(): string[] {
1413      const open = this.d
1414        .select({ id: councilRuns.id })
1415        .from(councilRuns)
1416        .where(eq(councilRuns.status, COUNCIL_RUN_RUNNING))
1417        .all()
1418        .map((r) => r.id)
1419      if (open.length > 0) {
1420        this.d
1421          .update(councilRuns)
1422          .set({ status: COUNCIL_RUN_ABANDONED })
1423          .where(eq(councilRuns.status, COUNCIL_RUN_RUNNING))
1424          .run()
1425      }
1426      return open
1427    }
1428  
1429    /**
1430     * Settle one council run's mint ledger: cost and the revocation timestamp, in
1431     * one write. Guarded on `revoked_at IS NULL` so a re-settle (a reconcile
1432     * racing a close) is a NO-WRITE rather than a second, contradictory record —
1433     * the `settleDispatchAttribution` discipline, verbatim.
1434     *
1435     * ⚠ IT NEVER TOUCHES `status`. Whether a run completed, failed or was
1436     * abandoned is the run's own history; revocation is the ledger's. Two writers
1437     * on one column is how a close gets silently undone.
1438     */
1439    settleCouncilRunMint(patch: {
1440      runId: string
1441      costUsd: number | null
1442      revokedAt: string | null
1443    }): void {
1444      this.d
1445        .update(councilRuns)
1446        .set({ costUsd: patch.costUsd, revokedAt: patch.revokedAt })
1447        .where(and(eq(councilRuns.id, patch.runId), isNull(councilRuns.revokedAt)))
1448        .run()
1449    }
1450  
1451    /** Settle one dispatch's attribution: cost, tokens, revocation timestamp and
1452     *  state, in one write. Guarded on `revoked_at IS NULL` so a re-settle (a
1453     *  double exit event, a reconcile racing a close) is a NO-WRITE rather than a
1454     *  second, contradictory record. */
1455    settleDispatchAttribution(patch: {
1456      dispatchId: string
1457      costUsd: number | null
1458      tokensIn: number | null
1459      tokensOut: number | null
1460      tokensCached: number | null
1461      tokensSource: string | null
1462      revokedAt: string | null
1463      attributionState: string
1464    }): void {
1465      this.d
1466        .update(dispatches)
1467        .set({
1468          costUsd: patch.costUsd,
1469          tokensIn: patch.tokensIn,
1470          tokensOut: patch.tokensOut,
1471          tokensCached: patch.tokensCached,
1472          tokensSource: patch.tokensSource,
1473          revokedAt: patch.revokedAt,
1474          attributionState: patch.attributionState
1475        })
1476        .where(and(eq(dispatches.id, patch.dispatchId), isNull(dispatches.revokedAt)))
1477        .run()
1478    }
1479  
1480    /** Rows whose analytics window was not fresh enough at close (§8, and D4
1481     *  obligation 3 — freshness is UNDOCUMENTED, so this path is mandatory).
1482     *  A row qualifies only if it was really metered (a hash) and really has no
1483     *  tokens yet (`tokens_source IS NULL`), so a genuine zero-token dispatch is
1484     *  never re-queried forever. */
1485    listPendingTokenBackfill(limit = 50): { dispatchId: string; hash: string; mintedAt: string }[] {
1486      return this.d
1487        .select({ dispatchId: dispatches.id, hash: dispatches.mintedKeyHash, mintedAt: dispatches.mintedAt })
1488        .from(dispatches)
1489        .where(
1490          and(
1491            isNotNull(dispatches.mintedKeyHash),
1492            isNotNull(dispatches.revokedAt),
1493            isNull(dispatches.tokensSource)
1494          )
1495        )
1496        .orderBy(desc(dispatches.mintedAt))
1497        .limit(limit)
1498        .all()
1499        .filter((r): r is { dispatchId: string; hash: string; mintedAt: string } =>
1500          typeof r.hash === 'string' && typeof r.mintedAt === 'string'
1501        )
1502    }
1503  
1504    /** The backfill write. Guarded on `tokens_source IS NULL` so it can NEVER
1505     *  overwrite a populated value — a later pass may only fill a gap. */
1506    backfillDispatchTokens(patch: {
1507      dispatchId: string
1508      tokensIn: number | null
1509      tokensOut: number | null
1510      tokensCached: number | null
1511      tokensSource: string
1512    }): void {
1513      this.d
1514        .update(dispatches)
1515        .set({
1516          tokensIn: patch.tokensIn,
1517          tokensOut: patch.tokensOut,
1518          tokensCached: patch.tokensCached,
1519          tokensSource: patch.tokensSource
1520        })
1521        .where(and(eq(dispatches.id, patch.dispatchId), isNull(dispatches.tokensSource)))
1522        .run()
1523    }
1524  
1525    /** The "% attributed" input: dispatches STARTED within the window. Started,
1526     *  not ended, so a run still open at the window edge is counted in the
1527     *  denominator it belongs to rather than vanishing from both. */
1528    listDispatchesForAttribution(
1529      fromIso: string,
1530      toIso: string
1531    ): {
1532      attributionState: string
1533      authMode: string
1534      costUsd: number | null
1535      tokensSource: string | null
1536    }[] {
1537      return this.d
1538        .select({
1539          attributionState: dispatches.attributionState,
1540          authMode: dispatches.authMode,
1541          costUsd: dispatches.costUsd,
1542          tokensSource: dispatches.tokensSource
1543        })
1544        .from(dispatches)
1545        .where(and(gte(dispatches.startedAt, fromIso), lte(dispatches.startedAt, toIso)))
1546        .all()
1547    }
1548  
1549    /* -------------------------------------------------------------------- */
1550    /* Attention capture (Phase 3a / Task 3a-2) over v7's attention_spans.    */
1551    /* THIS TASK AUTHORS NO MIGRATION — 3a-1 owns the table. Rows in, rows    */
1552    /* out; every classification decision lives in attentionCore.ts.          */
1553    /*                                                                        */
1554    /* ⚠ `seconds` is written as an ABSOLUTE value (samples x tick_seconds),  */
1555    /* never `seconds = seconds + 15`. The in-memory run is the authority, so */
1556    /* a retried write cannot double-credit, and "credited time is samples x  */
1557    /* tick_seconds and nothing else" is literal in the SQL rather than an    */
1558    /* invariant a reader has to reconstruct.                                 */
1559    /* -------------------------------------------------------------------- */
1560  
1561    /** Open a new span. Called on the FIRST tick of a run, so a tree-kill one
1562     *  millisecond later still leaves the run on disk. */
1563    openAttentionSpan(row: NewAttentionSpanRow): void {
1564      this.d.insert(attentionSpans).values(row).run()
1565    }
1566  
1567    /** Advance the open span. Called on EVERY subsequent tick — that is what
1568     *  bounds worst-case loss at one tick instead of at the length of the run. */
1569    extendAttentionSpan(id: string, endedAt: string, seconds: number): void {
1570      this.d
1571        .update(attentionSpans)
1572        .set({ endedAt, seconds })
1573        .where(eq(attentionSpans.id, id))
1574        .run()
1575    }
1576  
1577    /** Spans OVERLAPPING [fromIso, toIso] for a project — a run that began before
1578     *  the window and continues into it belongs to it. Defensive read, matching
1579     *  every other reader in this file: a hand-edited or corrupt row (unknown
1580     *  class, non-finite seconds) is DROPPED rather than thrown on, because a
1581     *  telemetry read must never be able to break the caller. */
1582    readAttentionSpans(projectId: string, fromIso: string, toIso: string): AttentionSpanRow[] {
1583      const rows = this.d
1584        .select()
1585        .from(attentionSpans)
1586        .where(
1587          and(
1588            eq(attentionSpans.projectId, projectId),
1589            lte(attentionSpans.startedAt, toIso),
1590            gte(attentionSpans.endedAt, fromIso)
1591          )
1592        )
1593        .orderBy(asc(attentionSpans.startedAt))
1594        .all()
1595      const classes = new Set<string>(attentionClassSchema.options)
1596      return rows.filter(
1597        (r) =>
1598          classes.has(r.class) &&
1599          Number.isFinite(r.seconds) &&
1600          r.seconds > 0 &&
1601          Number.isFinite(r.tickSeconds) &&
1602          r.tickSeconds > 0
1603      )
1604    }
1605  
1606    /** The kill switch (Task 3a-2): `attention_capture_enabled` in `settings`,
1607     *  DEFAULT ON, read live on every tick so flipping it takes effect without a
1608     *  restart. Same defensive-read discipline as getWindowBounds — an absent or
1609     *  corrupt row means the default, never a throw. There is deliberately no
1610     *  setter and no UI in this task (no dead UI, Task 3-4's bar); the row is
1611     *  written by hand or by a later settings task:
1612     *    INSERT INTO settings (key, value) VALUES ('attention_capture_enabled','false')
1613     *      ON CONFLICT(key) DO UPDATE SET value = excluded.value; */
1614    getAttentionCaptureEnabled(): boolean {
1615      const row = this.d
1616        .select()
1617        .from(settings)
1618        .where(eq(settings.key, 'attention_capture_enabled'))
1619        .get()
1620      if (!row) return true
1621      return row.value !== 'false'
1622    }
1623  
1624    getWindowBounds(): WindowBounds | null {
1625      const row = this.d.select().from(settings).where(eq(settings.key, 'window_bounds')).get()
1626      if (!row) return null
1627      try {
1628        const b = JSON.parse(row.value) as WindowBounds
1629        if ([b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n)) && b.width > 0 && b.height > 0) {
1630          return b
1631        }
1632      } catch {
1633        // fall through to null; a corrupt row just means default bounds
1634      }
1635      return null
1636    }
1637  
1638    saveWindowBounds(bounds: WindowBounds): void {
1639      const value = JSON.stringify(bounds)
1640      this.d
1641        .insert(settings)
1642        .values({ key: 'window_bounds', value })
1643        .onConflictDoUpdate({ target: settings.key, set: { value } })
1644        .run()
1645    }
1646  
1647    /** Per-project view state (Task 1b-2 / D20): inline-Drizzle settings pair,
1648     *  key `view_state:<projectId>`, same shape as getWindowBounds. Defensive
1649     *  read: a corrupt or hand-edited row returns null so the caller's filmstrip
1650     *  default applies. Plain-TS shape guard here (matching getWindowBounds);
1651     *  main's view:get handler does the authoritative Zod parse on the way out. */
1652    getViewState(projectId: string): ViewState | null {
1653      const row = this.d
1654        .select()
1655        .from(settings)
1656        .where(eq(settings.key, `view_state:${projectId}`))
1657        .get()
1658      if (!row) return null
1659      try {
1660        const v = JSON.parse(row.value) as ViewState
1661        if (
1662          (v.mode === 'filmstrip' || v.mode === 'grid') &&
1663          (v.focusedSessionId === null || typeof v.focusedSessionId === 'string')
1664        ) {
1665          return { mode: v.mode, focusedSessionId: v.focusedSessionId }
1666        }
1667      } catch {
1668        // fall through to null; a corrupt row just means the default applies
1669      }
1670      return null
1671    }
1672  
1673    setViewState(projectId: string, state: ViewState): void {
1674      const key = `view_state:${projectId}`
1675      const value = JSON.stringify(state)
1676      this.d
1677        .insert(settings)
1678        .values({ key, value })
1679        .onConflictDoUpdate({ target: settings.key, set: { value } })
1680        .run()
1681    }
1682  
1683    /* -------------------------------------------------------------------- */
1684    /* Phase 3a / D43: launch profiles. Rows in, rows out — NO POLICY here.   */
1685    /* Resolution, precedence and validation all live in launchProfiles.ts.   */
1686    /* -------------------------------------------------------------------- */
1687  
1688    listLaunchProfiles(): LaunchProfileRow[] {
1689      return this.d.select().from(launchProfiles).orderBy(asc(launchProfiles.label)).all()
1690    }
1691  
1692    getLaunchProfileById(id: string): LaunchProfileRow | null {
1693      return this.d.select().from(launchProfiles).where(eq(launchProfiles.id, id)).get() ?? null
1694    }
1695  
1696    getLaunchProfileByLabel(label: string): LaunchProfileRow | null {
1697      return this.d.select().from(launchProfiles).where(eq(launchProfiles.label, label)).get() ?? null
1698    }
1699  
1700    createLaunchProfile(row: NewLaunchProfileRow): LaunchProfileRow {
1701      this.d.insert(launchProfiles).values(row).run()
1702      const created = this.getLaunchProfileById(row.id)
1703      if (!created) throw new Error(`launch profile ${row.id} vanished after insert`)
1704      return created
1705    }
1706  
1707    /** Patch semantics: absent = unchanged, null = clear, a value = set. The
1708     *  caller (main) has already validated the merged shape. */
1709    updateLaunchProfile(id: string, patch: Partial<NewLaunchProfileRow>): LaunchProfileRow | null {
1710      if (Object.keys(patch).length > 0) {
1711        this.d.update(launchProfiles).set(patch).where(eq(launchProfiles.id, id)).run()
1712      }
1713      return this.getLaunchProfileById(id)
1714    }
1715  
1716    deleteLaunchProfile(id: string): void {
1717      this.d.delete(launchProfiles).where(eq(launchProfiles.id, id)).run()
1718    }
1719  
1720    /**
1721     * F16 count-and-refuse inputs. Both are REQUIRED before their delete handler
1722     * runs — never let SQLite throw a SQLITE_CONSTRAINT_FOREIGNKEY and then
1723     * translate the error into a user message (the failure Task 2-3 already paid
1724     * for once). The FK exists to make the refusal MANDATORY, not to author it.
1725     */
1726    countLaunchProfilesForProvider(providerId: string): number {
1727      return (
1728        this.d
1729          .select({ n: count() })
1730          .from(launchProfiles)
1731          .where(eq(launchProfiles.providerId, providerId))
1732          .get()?.n ?? 0
1733      )
1734    }
1735  
1736    countLaunchProfilesForCredential(credentialProfileId: string): number {
1737      return (
1738        this.d
1739          .select({ n: count() })
1740          .from(launchProfiles)
1741          .where(eq(launchProfiles.credentialProfileId, credentialProfileId))
1742          .get()?.n ?? 0
1743      )
1744    }
1745  
1746    /**
1747     * The per-project last-used pointer, keyed `last_launch_profile:<projectId>` —
1748     * the `view_state:<projectId>` pattern above, verbatim.
1749     *
1750     * ⚠ PER-PROJECT, NOT GLOBAL. The profile you last used in *Chorus* tells you
1751     * nothing about what you want in *Chorus-Second*; defaulting the second
1752     * project's dialog to the first project's choice is the same category error
1753     * `recent_cwds` already commits (observed, cited, deliberately not fixed
1754     * here). Retiring one global-by-default fact and creating another in the same
1755     * commit would be indefensible.
1756     *
1757     * ⚠ IT STORES THE ID, AND ONLY THE ID (D43). A pointer holding a label would
1758     * silently lose its default the first time a user renamed the profile — and a
1759     * rename must have zero downstream consequences. A DANGLING id resolves to
1760     * "no default", never to a fuzzy label match; the resolution happens in main.
1761     */
1762    getLastLaunchProfileId(projectId: string): string | null {
1763      const row = this.d
1764        .select()
1765        .from(settings)
1766        .where(eq(settings.key, `last_launch_profile:${projectId}`))
1767        .get()
1768      return row?.value ?? null
1769    }
1770  
1771    setLastLaunchProfileId(projectId: string, profileId: string): void {
1772      const key = `last_launch_profile:${projectId}`
1773      this.d
1774        .insert(settings)
1775        .values({ key, value: profileId })
1776        .onConflictDoUpdate({ target: settings.key, set: { value: profileId } })
1777        .run()
1778    }
1779  
1780    /* -------------------------------------------------------------------- */
1781    /* Phase 3b / Task 3b-2 (D62): the council. Rows in, rows out — NO POLICY */
1782    /* here. Resolution, the D56 precedence order and every validator live in */
1783    /* councilMembers.ts; every refusal is authored in main.                  */
1784    /* -------------------------------------------------------------------- */
1785  
1786    /** Ordered by label so main never has to sort, and the renderer never does. */
1787    listCouncilMembers(): CouncilMemberRow[] {
1788      return this.d.select().from(councilMembers).orderBy(asc(councilMembers.label)).all()
1789    }
1790  
1791    getCouncilMemberById(id: string): CouncilMemberRow | null {
1792      return this.d.select().from(councilMembers).where(eq(councilMembers.id, id)).get() ?? null
1793    }
1794  
1795    getCouncilMemberByLabel(label: string): CouncilMemberRow | null {
1796      return this.d.select().from(councilMembers).where(eq(councilMembers.label, label)).get() ?? null
1797    }
1798  
1799    createCouncilMember(row: NewCouncilMemberRow): CouncilMemberRow {
1800      this.d.insert(councilMembers).values(row).run()
1801      const created = this.getCouncilMemberById(row.id)
1802      if (!created) throw new Error(`council member ${row.id} vanished after insert`)
1803      return created
1804    }
1805  
1806    /** Patch semantics: absent = unchanged, null = clear, a value = set. The
1807     *  caller (main) has already validated the MERGED shape. */
1808    updateCouncilMember(id: string, patch: Partial<NewCouncilMemberRow>): CouncilMemberRow | null {
1809      if (Object.keys(patch).length > 0) {
1810        this.d.update(councilMembers).set(patch).where(eq(councilMembers.id, id)).run()
1811      }
1812      return this.getCouncilMemberById(id)
1813    }
1814  
1815    deleteCouncilMember(id: string): void {
1816      this.d.delete(councilMembers).where(eq(councilMembers.id, id)).run()
1817    }
1818  
1819    /**
1820     * ⚠ THE DELETE GUARD'S EVIDENCE, and it must run BEFORE the delete statement
1821     * (F16/D62). `council_members.credential_profile_id` carries a REAL, ENFORCED
1822     * `REFERENCES`, so without this count SQLite throws
1823     * SQLITE_CONSTRAINT_FOREIGNKEY straight through `credential:delete` — a flow
1824     * that has worked since Task 3-2. The FK exists to make the refusal
1825     * MANDATORY; this function is what lets somebody AUTHOR it.
1826     *
1827     * It sits BESIDE `countLaunchProfilesForCredential` above, not instead of it:
1828     * a credential can be referenced by both kinds of row, and the refusal names
1829     * both counts distinctly so the message tells the user what to remove.
1830     */
1831    countCouncilMembersForCredential(credentialProfileId: string): number {
1832      return (
1833        this.d
1834          .select({ n: count() })
1835          .from(councilMembers)
1836          .where(eq(councilMembers.credentialProfileId, credentialProfileId))
1837          .get()?.n ?? 0
1838      )
1839    }
1840  
1841    /* ---- runs + messages: WRITTEN NOW, FIRST CALLED IN TASK 3b-3 ----------
1842     *
1843     * ⚠ Deliberately unused by this task — the `attention_spans` precedent (v7),
1844     * where a table and its accessors shipped one task before their only writer
1845     * so the phase's schema churn stays in ONE migration. Both tables are created
1846     * EMPTY by v11 and nothing here inserts a row during 3b-2.
1847     */
1848  
1849    createCouncilRun(row: NewCouncilRunRow): CouncilRunRow {
1850      this.d.insert(councilRuns).values(row).run()
1851      const created = this.getCouncilRunById(row.id)
1852      if (!created) throw new Error(`council run ${row.id} vanished after insert`)
1853      return created
1854    }
1855  
1856    getCouncilRunById(id: string): CouncilRunRow | null {
1857      return this.d.select().from(councilRuns).where(eq(councilRuns.id, id)).get() ?? null
1858    }
1859  
1860    /** Newest first — a run list is read as history. */
1861    listCouncilRuns(): CouncilRunRow[] {
1862      return this.d.select().from(councilRuns).orderBy(desc(councilRuns.startedAt)).all()
1863    }
1864  
1865    updateCouncilRun(id: string, patch: Partial<NewCouncilRunRow>): CouncilRunRow | null {
1866      if (Object.keys(patch).length > 0) {
1867        this.d.update(councilRuns).set(patch).where(eq(councilRuns.id, id)).run()
1868      }
1869      return this.getCouncilRunById(id)
1870    }
1871  
1872    /**
1873     * ⚠ PURGES ITS OWN MESSAGES, IN ONE TRANSACTION, BECAUSE SQLITE WILL NOT.
1874     * `council_messages.run_id` is a SOFT pointer with no `REFERENCES` (D62: a
1875     * transcript is a historical fact and must survive its member's deletion), so
1876     * there is no cascade to inherit. The explicit purge is the
1877     * `deleteProviderConfig` -> `model_catalog` precedent: the table that carries
1878     * no FK is the one whose owner has to clean up after it.
1879     *
1880     * Nothing calls this yet. It exists so 3b-3 inherits the transaction rather
1881     * than inventing a second, half-atomic one.
1882     */
1883    deleteCouncilRun(id: string): void {
1884      this.d.transaction((tx) => {
1885        tx.delete(councilMessages).where(eq(councilMessages.runId, id)).run()
1886        tx.delete(councilRuns).where(eq(councilRuns.id, id)).run()
1887      })
1888    }
1889  
1890    appendCouncilMessage(row: NewCouncilMessageRow): CouncilMessageRow {
1891      this.d.insert(councilMessages).values(row).run()
1892      const created =
1893        this.d.select().from(councilMessages).where(eq(councilMessages.id, row.id)).get() ?? null
1894      if (!created) throw new Error(`council message ${row.id} vanished after insert`)
1895      return created
1896    }
1897  
1898    /** Round then insertion order — the shape the `council_messages_run` index
1899     *  (run_id, round) was created for. */
1900    getCouncilMessagesForRun(runId: string): CouncilMessageRow[] {
1901      return this.d
1902        .select()
1903        .from(councilMessages)
1904        .where(eq(councilMessages.runId, runId))
1905        .orderBy(asc(councilMessages.round), asc(councilMessages.createdAt))
1906        .all()
1907    }
1908  
1909    close(): void {
1910      this.db.close()
1911    }
1912  
1913    /** Resolve the legacy one-row-per-(project, agent) session for the lazy
1914     *  flat-layout conversion, creating it when absent so converted leaves bind
1915     *  stable row ids. Existing rows are reused so ids stay stable. */
1916    private findOrCreateSession(projectId: string, agent: AgentKind): SessionRow {
1917      const existing = this.d
1918        .select()
1919        .from(sessions)
1920        .where(and(eq(sessions.projectId, projectId), eq(sessions.agent, agent)))
1921        .get()
1922      if (existing) return existing
1923      const project = this.d.select().from(projects).where(eq(projects.id, projectId)).get()
1924      if (!project) throw new Error(`findOrCreateSession: unknown project ${projectId}`)
1925      return this.createSession({
1926        id: randomUUID(),
1927        projectId,
1928        agent,
1929        cwd: project.rootPath,
1930        status: 'running',
1931        exitCode: null,
1932        createdAt: new Date().toISOString()
1933      })
1934    }
1935  
1936    private migrate(): void {
1937      this.db.exec(
1938        'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
1939      )
1940      const applied = (
1941        this.db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as {
1942          v: number
1943        }
1944      ).v
1945      for (let version = applied + 1; version <= MIGRATIONS.length; version++) {
1946        const apply = this.db.transaction(() => {
1947          this.db.exec(MIGRATIONS[version - 1])
1948          this.db
1949            .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
1950            .run(version, new Date().toISOString())
1951        })
1952        apply()
1953      }
1954    }
1955  }
1956  
```

### Exhibit 6 — `src/shared/ipc.ts` (lines 1–1961, 99689 bytes)

```ts
   1  import { z } from 'zod'
   2  import type { LayoutNode } from './layout'
   3  import { PROJECT_COLOR_PATTERN } from './projectColors'
   4  
   5  /**
   6   * IPC contract between renderer and main.
   7   *
   8   * Every payload crossing the boundary is described here with a Zod schema.
   9   * Main parses all renderer -> main payloads before acting on them.
  10   * (D1: .parse() is called only in the main process — never in preload or
  11   * renderer, whose CSP forbids the eval Zod compiles parsers with.)
  12   */
  13  
  14  export const IpcChannel = {
  15    /** invoke: attach to (or lazily start) an agent's session */
  16    SessionAttach: 'session:attach',
  17    /** invoke: create a session row + spawn its PTY (launch dialog) */
  18    SessionLaunch: 'session:launch',
  19    /** invoke: project root + recent cwds + repo context (workspace modes, 2-2)
  20     *  for the launch dialog */
  21    SessionLaunchContext: 'session:launch-context',
  22    /** invoke: keyboard input from the renderer -> PTY stdin */
  23    SessionWrite: 'session:write',
  24    /** invoke: terminal geometry change -> pty.resize */
  25    SessionResize: 'session:resize',
  26    /** invoke: kill a live session's PTY process tree */
  27    SessionKill: 'session:kill',
  28    /** invoke: relaunch a session under its existing row id (D16 Q4: THE one
  29     *  restart path — in-run and post-restart alike; attach never spawns) */
  30    SessionRestart: 'session:restart',
  31    /** invoke: delete an exited session's row (pane close; rejects live sessions) */
  32    SessionDelete: 'session:delete',
  33    /** invoke: persist a session's captured title (OSC 0/2 or first-line fallback) */
  34    SessionSetTitle: 'session:set-title',
  35    /** event (main -> renderer): PTY output chunk */
  36    SessionData: 'session:data',
  37    /** event (main -> renderer): PTY process exited */
  38    SessionExit: 'session:exit',
  39    /** event (main -> renderer): restore engine relaunched this session (badge) */
  40    SessionRestored: 'session:restored',
  41    /** invoke: report which agent/tool CLIs are installed */
  42    CliDetect: 'cli:detect',
  43    /** invoke: static adapter declarations — capabilities + auth methods. No
  44     *  probing; cli:detect owns installation state. */
  45    AdapterList: 'adapter:list',
  46    /** invoke: fetch the persisted pane layout for a project */
  47    LayoutGet: 'layout:get',
  48    /** invoke: persist the current pane layout tree (ratio write-back) */
  49    LayoutSet: 'layout:set',
  50    /** invoke: read a project's persisted view state (mode + focused session) */
  51    ViewGet: 'view:get',
  52    /** invoke: persist a project's view state */
  53    ViewSet: 'view:set',
  54    /** invoke: native directory picker -> find-or-create a project (main only) */
  55    ProjectAdd: 'project:add',
  56    /** invoke: all projects with the active flag derived from settings */
  57    ProjectList: 'project:list',
  58    /** invoke: persist the active project, lazy-restore it, retitle the window */
  59    ProjectSelect: 'project:select',
  60    /** invoke: save a project's name + colour + description (settings screen) */
  61    ProjectUpdate: 'project:update',
  62    /** invoke: list a project's worktrees for the retained-worktree panel (2-3) */
  63    WorktreeList: 'worktree:list',
  64    /** invoke: remove a worktree through the D26 gates (typed token if dirty) */
  65    WorktreeRemove: 'worktree:remove',
  66    /** invoke: fresh git status --porcelain lines for one worktree (2-3) */
  67    WorktreeDirtyFiles: 'worktree:dirty-files',
  68    /** invoke: read-only {filesChanged, insertions, deletions, untracked} for a
  69     *  session's worktree (2-4); null for current-tree sessions */
  70    WorktreeDiffSummary: 'worktree:diff-summary',
  71    /** invoke: list provider configs (plaintext, non-secret metadata only) */
  72    ProviderList: 'provider:list',
  73    /** invoke: create a provider config */
  74    ProviderCreate: 'provider:create',
  75    /** invoke: update a provider config's non-secret fields */
  76    ProviderUpdate: 'provider:update',
  77    /** invoke: delete a provider config; refuses while profiles reference it */
  78    ProviderDelete: 'provider:delete',
  79    /** invoke: list credential profile METADATA — never key material (D33 c3) */
  80    CredentialList: 'credential:list',
  81    /** invoke: store a plaintext key; WRITE-ONLY INBOUND — returns only an id */
  82    CredentialCreate: 'credential:create',
  83    /** invoke: replace a profile's key by id; write-only inbound */
  84    CredentialReplace: 'credential:replace',
  85    /** invoke: delete a credential profile by id */
  86    CredentialDelete: 'credential:delete',
  87    /** invoke: ONE live auth probe, user-initiated only (D33 resolution d —
  88     *  "at your request" is load-bearing). Never at boot, launch, on a timer,
  89     *  or on profile creation. Returns a boolean + sanitized message. */
  90    CredentialTest: 'credential:test',
  91    /** invoke: read the cached model list for one provider + its freshness.
  92     *  PURE READ — makes NO network call and decrypts nothing. */
  93    ModelList: 'model:list',
  94    /** invoke: ONE live GET <base_url>/models, user-initiated only. The SECOND
  95     *  key-bearing call in the app — D33 resolution (d)'s carve-out, widened by
  96     *  exactly this call (Task 3a-4). Never at boot, launch, on a timer, on
  97     *  settings-open, or on profile creation. A success is NOT proof of
  98     *  authentication and does NOT write last_verified_at: this endpoint answers
  99     *  200 with no key at all. */
 100    ModelRefresh: 'model:refresh',
 101    /** invoke: D85 — add or remove ONE model id from a route's shortlist. PURE
 102     *  LOCAL WRITE: no network call, no decryption, no credential of any kind.
 103     *  It is the only channel that writes `model_shortlist`, and nothing that
 104     *  writes `model_catalog` can reach it. */
 105    ModelShortlistSet: 'model:shortlist-set',
 106    /** invoke: WRITE-ONLY INBOUND — the renderer's edge-triggered report of the
 107     *  four facts main cannot see (active project, which terminal host holds DOM
 108     *  focus, which view is up, whether an overlay owns the keyboard). Returns
 109     *  void; there is no read-back. Fire-and-forget, so main never throws at it. */
 110    AttentionReport: 'attention:report',
 111    /** invoke: attention-minutes for a project over a window — ALWAYS with its
 112     *  denominator. See attentionSummaryResponseSchema: there is no `minutes`
 113     *  field, by design. */
 114    AttentionSummary: 'attention:summary',
 115    /** invoke: "% of spend attributed" (D42) over a window — ALWAYS with the
 116     *  counts and dollars it was computed from (D55). Carries NO key material of
 117     *  any kind: not the minted key, not its hash, not the management key. */
 118    AttributionSummary: 'attribution:summary',
 119    /** invoke: the saved launch profiles, resolved and ordered by label in main.
 120     *  PURE READ — decrypts nothing. Carries a credential PROFILE ID and its
 121     *  LABEL and nothing else. */
 122    LaunchProfileList: 'launch-profile:list',
 123    /** invoke: save a launch profile (D43's (agent x route x model) triple). */
 124    LaunchProfileCreate: 'launch-profile:create',
 125    /** invoke: patch a launch profile. A RENAME IS A PURE UI EVENT with zero
 126     *  downstream consequences — every pointer stores the immutable id (D43). */
 127    LaunchProfileUpdate: 'launch-profile:update',
 128    /** invoke: delete a launch profile. Sessions hold a SOFT pointer, so no
 129     *  guard is needed here; the fail-safe predicate absorbs the dangling id. */
 130    LaunchProfileDelete: 'launch-profile:delete',
 131    /** invoke: the saved council members, resolved and ordered by label in main.
 132     *  PURE READ — decrypts nothing, calls nothing, spends nothing. Carries a
 133     *  credential PROFILE ID and its LABEL and nothing else. */
 134    CouncilMemberList: 'council-member:list',
 135    /** invoke: save a council member. A member names a ROUTE BY NAMING A
 136     *  CREDENTIAL (D48/D56): there is no base URL and no provider id on this
 137     *  channel, because there is none on the row. */
 138    CouncilMemberCreate: 'council-member:create',
 139    /** invoke: patch a council member. A RENAME IS A PURE UI EVENT with zero
 140     *  downstream consequences — every pointer stores the immutable id (D43). */
 141    CouncilMemberUpdate: 'council-member:update',
 142    /** invoke: delete a council member. Runs and messages hold SOFT pointers
 143     *  (D62), so no guard is needed here — a transcript stays true once the
 144     *  member that spoke it is gone. */
 145    CouncilMemberDelete: 'council-member:delete',
 146    /** invoke: relaunch a session that was healed to `exited` because it held a
 147     *  credential (D53).
 148     *
 149     *  ⚠ THE ONLY LAUNCH-CREDENTIAL DECRYPT ADDED BY TASK 3a-5, and it happens
 150     *  because a HUMAN CLICKED SOMETHING. Restore stays decision (b): there is no
 151     *  unattended boot-time resolution of a launch credential, and this channel
 152     *  is not reachable from any boot path, timer, restore path or retry. That
 153     *  distance is the entire security argument (D49/F26). */
 154    SessionRelaunch: 'session:relaunch',
 155    /** invoke: open the native picker for a brief `.md`. Main-side
 156     *  `dialog.showOpenDialog` (the `project:add` precedent), cancel returning a
 157     *  structured no-op rather than an error. ⚠ A CONVENIENCE, NOT A BOUNDARY —
 158     *  `council:start` re-validates whatever comes back. */
 159    CouncilPickBrief: 'council:pick-brief',
 160    /**
 161     * invoke: run a council deliberation over a brief and return its findings.
 162     *
 163     * ⚠ IT CARRIES THE BRIEF'S **PATH**, AND MAIN IS WHAT OPENS IT (3b-4).
 164     * `brief_text` was REMOVED rather than deprecated (D68(4)): two sources of
 165     * truth for what the council deliberated on, with the renderer controlling
 166     * the authoritative one, would have made the path validation decorative.
 167     * The findings `.md` path is DERIVED from it in main and never supplied.
 168     *
 169     * ⚠ THE FOURTH KEY-BEARING CALL PATH, admitted on D58's terms exactly as
 170     * `api:probe` was: user-initiated only — no boot hook, no timer, no restore
 171     * path, no retry — reusing `resolveCredential` rather than forking it, so the
 172     * management refusal still sits BEFORE decryption. D60 remains the invariant
 173     * and not the count.
 174     */
 175    CouncilStart: 'council:start',
 176    /** invoke: cancel a running deliberation. The run's minted key is still read
 177     *  back and revoked — an abandoned run leaving a live funded key is the
 178     *  failure mode 3a-3's ledger exists for. */
 179    CouncilCancel: 'council:cancel',
 180    /** event (main -> renderer): one scrubbed delta from one member's stream.
 181     *  ⚠ ITS TEXT COMES FROM `SessionOutput`'s `onText`, never from the raw
 182     *  stream — see `councilService.driveMember`. */
 183    CouncilProgress: 'council:progress',
 184    /**
 185     * invoke: read a stored run's transcript back. **D97, Task 3e-4 — and THE ONLY
 186     * CHANNEL PHASE 3e ADDS**, declared in `Phase-3e-Overview.md` before the task
 187     * ran (the D74/D80 discipline: an exception is stated up front or it is not an
 188     * exception, it is a leak). 57 → 58, and every other 3e task holds at 58.
 189     *
 190     * ⚠ READ-ONLY, AND THERE IS NO PARAMETER HERE THAT COULD BECOME A WRITE. It
 191     * takes a run id and returns rows. `deleteCouncilRun` exists in storage and is
 192     * deliberately NOT reachable from the renderer: a delete path is a different
 193     * decision with a different blast radius, and D97 did not make it.
 194     *
 195     * Why it exists: `council_messages` has been written on every run since 3b-3
 196     * and read by nothing. A run costs ~$0.83 and ~14 minutes, and until now the
 197     * only view of its deliberation was the live one — gone on the next run, gone
 198     * on restart. This is the door to data that was already being paid for.
 199     */
 200    CouncilTranscript: 'council:transcript',
 201    /**
 202     * Task 3c-2 / D74: the four window-control channels, and THE ONLY IPC
 203     * ADDITION IN ALL OF PHASE 3c. They exist because `frame: false` removed the
 204     * native frame: with no OS chrome, the renderer's own buttons have no way to
 205     * minimize, maximize or close except by asking main. The exception is
 206     * bounded and was recorded in `Phase-3c-Overview.md` BEFORE the task ran —
 207     * no other 3c task may add a channel, and 3c-2 may add none beyond these.
 208     */
 209    /** invoke: minimize the main window. Renderer -> main, no payload, no result. */
 210    WindowMinimize: 'window:minimize',
 211    /** invoke: maximize if restored, restore if maximized. Returns the NEW state
 212     *  so the caller can settle its icon without waiting for the event below. */
 213    WindowToggleMaximize: 'window:toggle-maximize',
 214    /** invoke: close the main window (the normal quit path, not a force kill —
 215     *  `close()` runs 'before-quit' and the session teardown behind it). */
 216    WindowClose: 'window:close',
 217    /** event (main -> renderer): the maximized state changed.
 218     *
 219     *  ⚠ REQUIRED, NOT A CONVENIENCE. The state changes by routes the renderer
 220     *  never sees — double-clicking the drag region, Win+↑ / Win+↓, or the OS
 221     *  snapping the window. Wiring only the button's own click leaves the
 222     *  restore icon silently desynced from the window it describes, which is the
 223     *  classic defect here. */
 224    WindowMaximizedChanged: 'window:maximized-changed'
 225  } as const
 226  
 227  /**
 228   * Task 3a-3: the `provider_configs.auth_mode` value marking an ACCOUNT-LEVEL
 229   * credential rather than a way to launch an agent.
 230   *
 231   * ⚠ THIS IS DELIBERATELY NOT AN `AuthMethodDefinition.type`, and that is the
 232   * whole point. Widening the adapter auth union would make "Management key"
 233   * appear in the launch picker as a way to run codex — semantically false, and
 234   * it would push the highest-privilege credential in the app toward the exact
 235   * launch path this task exists to keep it away from. Instead the value lives
 236   * here, on the wire contract, where `auth_mode` already is an unconstrained
 237   * string on both sides (no migration, no wire-schema change), and:
 238   *
 239   *  - `LaunchDialog.vue` already filters `provider.auth_mode === 'api_key'`, so
 240   *    a management row is invisible to the launch picker FOR FREE;
 241   *  - `resolveCredential` in main refuses it outright, because main never trusts
 242   *    the renderer and a filter in the dialog is not a guarantee.
 243   */
 244  export const MANAGEMENT_AUTH_MODE = 'management'
 245  
 246  /**
 247   * D84 (Task 3d-1): the `provider_configs.adapter_type` value marking a route
 248   * that NO LOCAL HARNESS RUNS.
 249   *
 250   * ⚠ `adapter_type` NAMES THE HARNESS, NOT THE SERVICE. That is the ruling. It
 251   * was carrying two jobs — "which CLI will run this" (the launch path's
 252   * ownership check, correct and load-bearing) and "which service is being
 253   * talked to" (which has nothing to do with a PTY agent) — and every provider
 254   * had to answer the first even when only the second was true. A council member
 255   * on OpenRouter had to claim `codex` or `claude`, which is a false statement
 256   * the launch dialog then acts on.
 257   *
 258   * `'none'` is the honest answer to "which harness": there isn't one. It is a
 259   * PROVIDER-TYPE value, exactly as `MANAGEMENT_AUTH_MODE` is an AUTH-MODE
 260   * value, and for the same reason it lives here rather than in `agentKindSchema`
 261   * or `staticRegistry`: those two must widen TOGETHER or F25 returns (the
 262   * `layout:get` filter treats `getAdapter(row.agent)` membership as proof of
 263   * `agentKindSchema` validity), and the registry freeze is D34 Q5 / D63 Q1,
 264   * owned by Phase 3d proper. Neither widens here.
 265   *
 266   * What holds it in place, none of it new:
 267   *  - `LaunchDialog.vue`'s `eligibleProfiles` filters `adapter_type === agent`,
 268   *    so a harness-less provider is invisible to the launch picker FOR FREE;
 269   *  - `validateProfileShape` / `resolveLaunchProfile` refuse a launch profile
 270   *    whose route disagrees with its agent, unchanged;
 271   *  - `resolveCredential`'s ownership check (Blocker B) is UNTOUCHED for every
 272   *    caller that names a harness.
 273   *
 274   * ⚠ `adapter_type` stays `TEXT NOT NULL` / `z.string().min(1).max(60)`. This is
 275   * a value in an already-open vocabulary, not a schema change and not a
 276   * migration.
 277   */
 278  export const NO_HARNESS_ADAPTER_TYPE = 'none'
 279  
 280  export const sessionStatusSchema = z.enum(['running', 'exited'])
 281  export type SessionStatus = z.infer<typeof sessionStatusSchema>
 282  
 283  /**
 284   * Agent CLIs Chorus can run. N concurrent sessions per kind (Task 1-4).
 285   *
 286   * ⚠ D86 (Task 3d-3) LIFTED D34 Q5's FREEZE AND ADDED `'kimi'`. Two entries
 287   * became three, and the lift is a numbered decision rather than an edit
 288   * because of what this enum is coupled to:
 289   *
 290   * **THIS AND `staticRegistry` WIDEN TOGETHER OR F25 RETURNS.** `layout:get`'s
 291   * projection filter treats `getAdapter(row.agent)` membership as PROOF of
 292   * `agentKindSchema` validity — true only while the registry is keyed by this
 293   * enum. An id admitted to one and not the other passes the filter and then
 294   * fails the outbound parse, taking the WHOLE aggregate down over one row.
 295   * `registry.ts` is typed `Readonly<Record<AgentKind, AgentAdapter>>`, so the
 296   * compiler enforces exact coverage in both directions: adding a kind here
 297   * without an adapter is a BUILD failure, and vice versa. That property is
 298   * D34(b)'s and it is what makes this lift safe to perform at all.
 299   *
 300   * ⚠ AND `NO_HARNESS_ADAPTER_TYPE` IS STILL NOT IN HERE (D84). A provider type
 301   * is not an agent kind; 'none' names the absence of a harness and must never
 302   * become a launchable id.
 303   *
 304   * ⚠ D90 (2026-07-28) ADDED `'opencode'` — THREE ENTRIES BECAME FOUR, under the
 305   * same widen-together rule D86 performed the last lift by. `opencode` is the
 306   * harness Matthew chose for the OpenRouter launch card: it is a real PTY agent
 307   * CLI (`opencode 1.18.8`, npm `opencode-ai`), so it belongs HERE and in
 308   * `staticRegistry`, unlike `NO_HARNESS_ADAPTER_TYPE` above. See `opencode.ts`
 309   * for the D4 evidence that a key can reach it through the ENVIRONMENT — which
 310   * is what makes it adoptable at all under the project's secret rules.
 311   */
 312  export const agentKindSchema = z.enum(['claude', 'codex', 'kimi', 'opencode'])
 313  export type AgentKind = z.infer<typeof agentKindSchema>
 314  
 315  /**
 316   * Task 3a-4: the app-level effort vocabulary — PLAN §4's Fast / Balanced /
 317   * Deep / Max slider. ONE vocabulary, shared by the wire, both adapters, and
 318   * (later) 3a-5's `launch_profiles.effort`.
 319   *
 320   * Declared this early in the file because both `launchRequestSchema` and
 321   * `effortOptionSchema` consume it, and a second copy would be a second home
 322   * for the same fact.
 323   *
 324   * Four normalized levels cannot cover every vendor's ladder, and stretching
 325   * them to try would make "Deep" mean different distances on different
 326   * adapters — claude's `xhigh` and codex's `none`/`minimal`/`ultra` are
 327   * deliberately unreachable from the slider. The raw `extra_args` override is
 328   * what reaches the rest (PLAN §4), which is why it is rank 1 of the effort
 329   * precedence order.
 330   */
 331  export const effortLevelSchema = z.enum(['fast', 'balanced', 'deep', 'max'])
 332  export type EffortLevel = z.infer<typeof effortLevelSchema>
 333  
 334  export const attachRequestSchema = z.object({
 335    agent: agentKindSchema,
 336    /** Stable sessions-row id (Task 1-2). Attach is a PURE VIEW BINDING with no
 337     *  spawn path at all (Task 1-5/D16: the 1-4 attach-time relaunch gate is
 338     *  gone — all relaunch goes through session:restart or the restore engine). */
 339    sessionId: z.uuid()
 340  })
 341  export type AttachRequest = z.infer<typeof attachRequestSchema>
 342  
 343  export const attachResponseSchema = z.object({
 344    sessionId: z.string().min(1),
 345    /** replay of recent output so a reloaded renderer repaints the screen */
 346    buffer: z.string(),
 347    status: sessionStatusSchema,
 348    exitCode: z.number().int().nullable(),
 349    /** Restore engine found the row's cwd gone (D16 clause 3): the pane renders
 350     *  its own "Working directory not found" chrome — never a sentinel exit code. */
 351    cwdMissing: z.boolean().optional(),
 352    /** The restore engine has this id queued for a staggered relaunch: the pane
 353     *  shows a restoring spinner instead of transient exited chrome. */
 354    restorePending: z.boolean().optional(),
 355    /** The restore engine relaunched this session and no pane has attached
 356     *  since: the first attach to report it wears the transient "new
 357     *  conversation" badge (consumed on report — exactly one badge per relaunch,
 358     *  immune to how late the pane mounts). */
 359    restored: z.boolean().optional(),
 360    /** 1b-1: seed the header on attach. Required-NULLABLE (not .optional()) so a
 361     *  producer that forgets it fails the outbound parse loudly. */
 362    title: z.string().nullable(),
 363    /** 2-2: the session's worktree branch, or null for current-tree sessions.
 364     *  Required-nullable, same discipline as title. Resolved in main from the
 365     *  WORKTREES side (worktrees.session_id — F18 resolution a), so a
 366     *  crash-window NULL sessions.worktree_id never hides the label. */
 367    branch: z.string().nullable(),
 368    /** 2-3: the owning worktree row's id, or null for current-tree sessions.
 369     *  Required-nullable, same discipline as branch. The pane close flow acts by
 370     *  worktree id (clean-removal offer / dirty detach); resolved row-side
 371     *  exactly like branch (F18a). */
 372    worktreeId: z.string().nullable()
 373  })
 374  export type AttachResponse = z.infer<typeof attachResponseSchema>
 375  
 376  /* ------------------------------------------------------------------ */
 377  /* Task 2-2: workspace modes (D22 + D26f)                              */
 378  /* ------------------------------------------------------------------ */
 379  
 380  /** The three workspace modes a launch can run in (D22; read-only deferred to
 381   *  Phase 3+). The mode ALWAYS travels explicitly in the launch payload — main
 382   *  computes a suggestion for the dialog and validates the chosen mode at
 383   *  launch, but never silently substitutes one mode for another. */
 384  export const workspaceModeSchema = z.enum(['current-tree', 'new-worktree', 'existing-worktree'])
 385  export type WorkspaceMode = z.infer<typeof workspaceModeSchema>
 386  
 387  /** A worktree the existing-worktree picker can offer: `detached`, or `active`
 388   *  with no live owning session (main computes attachability — the picker is a
 389   *  view of main's verdict, never its own authority). */
 390  export const pickableWorktreeSchema = z.object({
 391    id: z.uuid(),
 392    branch: z.string(),
 393    path: z.string(),
 394    status: z.string()
 395  })
 396  export type PickableWorktree = z.infer<typeof pickableWorktreeSchema>
 397  
 398  /** The D26(f) suggestion rule, factored pure for the unit test: a non-git
 399   *  project root offers only current-tree; ≥1 OTHER live session already
 400   *  writing the same repo flips the dialog DEFAULT to new-worktree; anything
 401   *  else stays current-tree. A suggestion only — the chosen mode is
 402   *  re-validated against the actual cwd at launch. */
 403  export function suggestMode(repoRoot: string | null, liveSessionsInRepo: number): WorkspaceMode {
 404    if (repoRoot === null) return 'current-tree'
 405    return liveSessionsInRepo >= 1 ? 'new-worktree' : 'current-tree'
 406  }
 407  
 408  /**
 409   * session:launch request. `cwd` is only min(1) here BY DESIGN: the absolute-
 410   * path + exists checks touch the filesystem and live in the main-process
 411   * handler, where they are the security boundary — never in a shared schema.
 412   */
 413  export const launchRequestSchema = z.object({
 414    /** Task 1-5: every handler resolves the project per-request (validated here
 415     *  as a uuid, FK-checked against the projects table in main). */
 416    project_id: z.uuid(),
 417    agent: agentKindSchema,
 418    cwd: z.string().min(1),
 419    /** 2-2: the chosen workspace mode — REQUIRED, always explicit (D22). */
 420    workspace_mode: workspaceModeSchema,
 421    /** The existing-worktree pick. Required-when-existing is enforced in MAIN
 422     *  (an {ok:false} inline reason), not by schema branching; absent/ignored
 423     *  for current-tree and new-worktree. */
 424    worktree_id: z.uuid().optional(),
 425    /** Task 3-6: the BYOK pick — a credential PROFILE ID, never a key (D33
 426     *  clause 2/Q2: main resolves and decrypts server-side only). Absent is
 427     *  the first-class subscription/ambient path (D33 clause 9). */
 428    credential_profile_id: z.uuid().optional(),
 429    /** Task 3a-4: the app-level effort level for THIS launch. Optional, and
 430     *  absent means Chorus emits no effort argument at all — the CLI's own
 431     *  default, which is what makes a no-effort launch byte-identical to a
 432     *  pre-3a-4 one.
 433     *
 434     *  Task 3a-5 persists it on `launch_profiles.effort` and PREFILLS THIS SAME
 435     *  FIELD from the chosen profile — there is deliberately NO second effort
 436     *  field on this payload. If the payload carries one, THE PAYLOAD WINS,
 437     *  because it is what the user is looking at; the profile is the default. */
 438    effort: effortLevelSchema.optional(),
 439    /** Task 3a-5 / D43: launch from a saved profile.
 440     *
 441     *  ⚠ MUTUALLY EXCLUSIVE with credential_profile_id — both present is refused
 442     *  in MAIN with an authored reason, deliberately NOT by schema branching, so
 443     *  the refusal has a place to say why. ONE resolver, ONE source of truth for
 444     *  the credential.
 445     *
 446     *  The division of authority: the PROFILE supplies the credential, route,
 447     *  model, effort, permission mode and env; the PAYLOAD still supplies
 448     *  `agent`, `cwd` and `workspace_mode`, because the user may change all three
 449     *  after picking a profile and because `cwd` is the SECURITY BOUNDARY main
 450     *  validates itself — a stored row is untrusted input like any other. */
 451    launch_profile_id: z.uuid().optional(),
 452    /**
 453     * D90 (2026-07-28): THE MODEL CHOSEN FOR THIS LAUNCH — rank 0 of D56's
 454     * precedence order, ahead of `launch_profiles.model` and
 455     * `provider_configs.model`.
 456     *
 457     * ⚠ THIS REVISES D81, WHICH SAID `LaunchDialog` HAS NO MODEL INPUT, AND IT
 458     * DOES NOT REOPEN WHAT D48 CLOSED. D48's objection was to a FREE-TEXT model
 459     * field standing beside the route's own default — two hand-authored homes for
 460     * one fact, drifting apart. This is not that. It is a CLOSED PICK from a list
 461     * main already owns (`model_shortlist`, then `model_catalog` — D85), it is
 462     * never persisted by the launch path, and it writes to NOTHING: grep this
 463     * feature for `UPDATE provider_configs` and the answer is still zero. The
 464     * route's default remains the default; this says only "not that one, today".
 465     *
 466     * ⚠ AND IT IS RESOLVED IN MAIN, exactly like every other rank. The renderer
 467     * sends the id it was offered; `session:launch` decides what wins. There is
 468     * no second precedence table in a `.vue` file (the D48/D56 rule that
 469     * `resolvedModel` in LaunchDialog.vue already obeys).
 470     *
 471     * Absent means "no per-launch choice" and the pre-D90 order applies
 472     * unchanged, which is what keeps every existing launch byte-identical.
 473     */
 474    model: z.string().min(1).max(200).optional()
 475  })
 476  export type LaunchRequest = z.infer<typeof launchRequestSchema>
 477  
 478  /** Launch outcome: the attach-style snapshot of the new session, or a
 479   *  structured validation failure the dialog shows inline. */
 480  export const launchResponseSchema = z.union([
 481    attachResponseSchema,
 482    z.object({ ok: z.literal(false), reason: z.string() })
 483  ])
 484  export type LaunchResponse = z.infer<typeof launchResponseSchema>
 485  
 486  export const launchContextRequestSchema = z.object({ project_id: z.uuid() })
 487  export type LaunchContextRequest = z.infer<typeof launchContextRequestSchema>
 488  
 489  /* ------------------------------------------------------------------ */
 490  /* Task 3a-5 / D43: launch profiles                                     */
 491  /* ------------------------------------------------------------------ */
 492  
 493  /** ⚠ A SAVED profile may not pin a transient worktree row. `existing-worktree`
 494   *  names a specific `worktrees` row that may be gone by the next launch, so it
 495   *  is a launch-time choice, never a stored one. Deliberately a SUBSET of
 496   *  workspaceModeSchema rather than a second copy. */
 497  export const savedWorkspaceModeSchema = z.enum(['current-tree', 'new-worktree'])
 498  export type SavedWorkspaceMode = z.infer<typeof savedWorkspaceModeSchema>
 499  
 500  /**
 501   * One launch profile on the wire.
 502   *
 503   * ⚠ Carries a credential PROFILE ID and its LABEL and NOTHING ELSE. There is no
 504   * field here capable of holding key material, and `src/shared/ipc.test.ts`
 505   * asserts that over the parse output's KEY SET (the 3-2 discipline) rather than
 506   * by spot-checking.
 507   *
 508   * `disabled_reason` is computed in MAIN by resolveLaunchProfile. An unlaunchable
 509   * profile is SHOWN and DISABLED with its reason, never filtered out: a launch
 510   * profile is a row the USER NAMED, and hiding it is a worse experience than
 511   * explaining it. (This deliberately differs from 3-6's `eligibleProfiles`,
 512   * which hides unavailable CREDENTIAL profiles — those are plumbing.)
 513   */
 514  export const launchProfileWireSchema = z.object({
 515    id: z.uuid(),
 516    label: z.string().min(1).max(120),
 517    agent: agentKindSchema,
 518    provider_id: z.uuid().nullable(),
 519    provider_name: z.string().max(120).nullable(),
 520    credential_profile_id: z.uuid().nullable(),
 521    credential_label: z.string().max(120).nullable(),
 522    /** The RESOLVED model (profile -> route -> null), so the renderer never
 523     *  re-implements 3a-4's precedence table and cannot create a second home. */
 524    model: z.string().max(200).nullable(),
 525    /** 3a-4's effortLevelSchema, IMPORTED — not z.string(), and not a second
 526     *  enum. A parallel effort vocabulary is exactly the two-homes failure D48
 527     *  exists to prevent. */
 528    effort: effortLevelSchema.nullable(),
 529    permission_mode: z.string().max(40).nullable(),
 530    workspace_mode: savedWorkspaceModeSchema,
 531    env_json: z.string().max(4096).nullable(),
 532    disabled_reason: z.string().nullable(),
 533    created_at: z.string(),
 534    updated_at: z.string()
 535  })
 536  export type LaunchProfileWire = z.infer<typeof launchProfileWireSchema>
 537  
 538  export const launchProfileListResponseSchema = z.object({
 539    profiles: z.array(launchProfileWireSchema)
 540  })
 541  export type LaunchProfileListResponse = z.infer<typeof launchProfileListResponseSchema>
 542  
 543  export const launchProfileCreateRequestSchema = z.object({
 544    label: z.string().min(1).max(120),
 545    agent: agentKindSchema,
 546    provider_id: z.uuid().nullable(),
 547    credential_profile_id: z.uuid().nullable(),
 548    model: z.string().min(1).max(200).nullable(),
 549    effort: effortLevelSchema.nullable(),
 550    permission_mode: z.string().min(1).max(40).nullable(),
 551    workspace_mode: savedWorkspaceModeSchema,
 552    /** NON-SECRET string->string additions. Main runs every VALUE through
 553     *  scrubSecrets and REFUSES if it carries a known key shape — the
 554     *  extra_headers_json precedent. A key belongs in a credential. */
 555    env_json: z.string().max(4096).nullable()
 556  })
 557  export type LaunchProfileCreateRequest = z.infer<typeof launchProfileCreateRequestSchema>
 558  
 559  export const launchProfileCreateResponseSchema = z.union([
 560    z.object({ ok: z.literal(true), profile: launchProfileWireSchema }),
 561    z.object({ ok: z.literal(false), reason: z.string() })
 562  ])
 563  export type LaunchProfileCreateResponse = z.infer<typeof launchProfileCreateResponseSchema>
 564  
 565  /** Patch semantics: absent = unchanged; null = clear; a value = set. */
 566  export const launchProfileUpdateRequestSchema = z.object({
 567    id: z.uuid(),
 568    label: z.string().min(1).max(120).optional(),
 569    model: z.string().min(1).max(200).nullable().optional(),
 570    effort: effortLevelSchema.nullable().optional(),
 571    permission_mode: z.string().min(1).max(40).nullable().optional(),
 572    workspace_mode: savedWorkspaceModeSchema.optional(),
 573    credential_profile_id: z.uuid().nullable().optional(),
 574    env_json: z.string().max(4096).nullable().optional()
 575  })
 576  export type LaunchProfileUpdateRequest = z.infer<typeof launchProfileUpdateRequestSchema>
 577  
 578  export const launchProfileUpdateResponseSchema = z.union([
 579    z.object({ ok: z.literal(true), profile: launchProfileWireSchema }),
 580    z.object({ ok: z.literal(false), reason: z.string() })
 581  ])
 582  export type LaunchProfileUpdateResponse = z.infer<typeof launchProfileUpdateResponseSchema>
 583  
 584  export const launchProfileDeleteRequestSchema = z.object({ id: z.uuid() })
 585  export type LaunchProfileDeleteRequest = z.infer<typeof launchProfileDeleteRequestSchema>
 586  
 587  export const launchProfileDeleteResponseSchema = z.union([
 588    z.object({ ok: z.literal(true) }),
 589    z.object({ ok: z.literal(false), reason: z.string() })
 590  ])
 591  export type LaunchProfileDeleteResponse = z.infer<typeof launchProfileDeleteResponseSchema>
 592  
 593  /* ------------------------------------------------------------------ */
 594  /* Phase 3b / Task 3b-2 (D62): council members                          */
 595  /* ------------------------------------------------------------------ */
 596  
 597  /**
 598   * The two things a member can be. `arbiter` breaks a deadlock; `member` argues.
 599   *
 600   * ⚠ THE VOCABULARY LIVES HERE AND NOWHERE ELSE. There is deliberately NO
 601   * `CHECK` constraint on `council_members.role` — that would put the list in two
 602   * places and make widening it a MIGRATION, which is exactly how `auth_mode` and
 603   * `status` are already handled. Main validates against this schema on the way
 604   * in AND on the way out, so a hand-edited row cannot render as a legal role.
 605   */
 606  export const councilRoleSchema = z.enum(['member', 'arbiter'])
 607  export type CouncilRole = z.infer<typeof councilRoleSchema>
 608  
 609  /**
 610   * One council member on the wire.
 611   *
 612   * ⚠ IDS AND LABELS ONLY. There is no field here capable of holding key
 613   * material, and `src/shared/ipc.test.ts` asserts that over the parse output's
 614   * KEY SET (the 3-2 discipline) rather than by spot-checking. `.strict()` makes
 615   * it loud: zod would otherwise silently STRIP an unknown key, letting a raw row
 616   * pass with its extra columns dropped unnoticed.
 617   *
 618   * ⚠ NO `baseUrl` AND NO `providerId`, MIRRORING THE ROW. The route has ONE home
 619   * (D48) and is reached through the credential; `providerName` is here purely so
 620   * the list can say which route a member speaks on, and it is a NAME, not a
 621   * route. Adding either field back is the change a reviewer must refuse.
 622   *
 623   * ⚠ NO `paramsJson` EITHER — deliberately WRITE-ONLY INBOUND. A member's
 624   * parameters are user-authored free text and therefore the field most able to
 625   * carry a pasted key; main refuses one that matches a known key shape at write
 626   * time, and never echoes the value back into the DOM.
 627   *
 628   * `model` is the RAW COLUMN and `resolvedModel` is D56's answer. Both are on
 629   * the wire on purpose: the UI has to be able to show that a NULL model column
 630   * INHERITS the route's default rather than being empty, and a single field
 631   * would make those two facts indistinguishable — which is precisely how a
 632   * "helpful" back-write into rank 1 gets written by someone reading the UI.
 633   */
 634  export const councilMemberWireSchema = z
 635    .object({
 636      id: z.uuid(),
 637      label: z.string().min(1).max(120),
 638      credentialProfileId: z.uuid(),
 639      credentialLabel: z.string().max(120).nullable(),
 640      providerName: z.string().max(120).nullable(),
 641      /** D56 RANK 1 — the raw column, NULL when this member inherits. */
 642      model: z.string().max(200).nullable(),
 643      /** D56 RESOLVED — rank 1 > the route's rank 2 > null. COMPUTED IN MAIN and
 644       *  NEVER WRITTEN BACK to the row (that is the second home D48 forbids). */
 645      resolvedModel: z.string().max(200).nullable(),
 646      role: councilRoleSchema,
 647      /** False when the member cannot deliberate — a management route, a missing
 648       *  or unavailable credential. The row is still SHOWN and EXPLAINED. */
 649      available: z.boolean(),
 650      /** Main's authored, LABEL-ONLY reason. Never a URL, an env var name, or a
 651       *  key fragment — the `vaultCore.failureMessage` vocabulary. */
 652      unavailableReason: z.string().nullable()
 653    })
 654    .strict()
 655  export type CouncilMemberWire = z.infer<typeof councilMemberWireSchema>
 656  
 657  export const councilMemberListRequestSchema = z.object({})
 658  export type CouncilMemberListRequest = z.infer<typeof councilMemberListRequestSchema>
 659  
 660  export const councilMemberListResponseSchema = z.object({
 661    members: z.array(councilMemberWireSchema)
 662  })
 663  export type CouncilMemberListResponse = z.infer<typeof councilMemberListResponseSchema>
 664  
 665  export const councilMemberCreateRequestSchema = z.object({
 666    label: z.string().min(1).max(120),
 667    /** ⚠ NOT NULLABLE, and there is no `providerId` beside it. A council member
 668     *  ALWAYS AUTHENTICATES — D33 clause 9's route-without-credential case does
 669     *  not reach here — so the credential is the one pointer, and the route is
 670     *  derived from it. */
 671    credentialProfileId: z.uuid(),
 672    /** D56 rank 1. NULL means "inherit this route's default", which is a real
 673     *  choice and not an absence. */
 674    model: z.string().min(1).max(200).nullable(),
 675    role: councilRoleSchema,
 676    /** NON-SECRET JSON object of member parameters (temperature, top_p, …).
 677     *  Main REFUSES any value carrying a known key shape — the
 678     *  `extra_headers_json` precedent. Never echoed back. */
 679    paramsJson: z.string().max(4096).nullable()
 680  })
 681  export type CouncilMemberCreateRequest = z.infer<typeof councilMemberCreateRequestSchema>
 682  
 683  export const councilMemberCreateResponseSchema = z.union([
 684    z.object({ ok: z.literal(true), member: councilMemberWireSchema }),
 685    z.object({ ok: z.literal(false), reason: z.string() })
 686  ])
 687  export type CouncilMemberCreateResponse = z.infer<typeof councilMemberCreateResponseSchema>
 688  
 689  /** Patch semantics: absent = unchanged; null = clear; a value = set. */
 690  export const councilMemberUpdateRequestSchema = z.object({
 691    id: z.uuid(),
 692    label: z.string().min(1).max(120).optional(),
 693    credentialProfileId: z.uuid().optional(),
 694    model: z.string().min(1).max(200).nullable().optional(),
 695    role: councilRoleSchema.optional(),
 696    paramsJson: z.string().max(4096).nullable().optional()
 697  })
 698  export type CouncilMemberUpdateRequest = z.infer<typeof councilMemberUpdateRequestSchema>
 699  
 700  export const councilMemberUpdateResponseSchema = z.union([
 701    z.object({ ok: z.literal(true), member: councilMemberWireSchema }),
 702    z.object({ ok: z.literal(false), reason: z.string() })
 703  ])
 704  export type CouncilMemberUpdateResponse = z.infer<typeof councilMemberUpdateResponseSchema>
 705  
 706  export const councilMemberDeleteRequestSchema = z.object({ id: z.uuid() })
 707  export type CouncilMemberDeleteRequest = z.infer<typeof councilMemberDeleteRequestSchema>
 708  
 709  export const councilMemberDeleteResponseSchema = z.union([
 710    z.object({ ok: z.literal(true) }),
 711    z.object({ ok: z.literal(false), reason: z.string() })
 712  ])
 713  export type CouncilMemberDeleteResponse = z.infer<typeof councilMemberDeleteResponseSchema>
 714  
 715  export const relaunchRequestSchema = z.object({ sessionId: z.string().min(1) })
 716  export type RelaunchRequest = z.infer<typeof relaunchRequestSchema>
 717  
 718  /**
 719   * Same union SHAPE as restartResponseSchema, and deliberately its OWN schema
 720   * rather than an alias: the two verbs differ in meaning — restart means "same
 721   * configuration, NO credential"; relaunch means "same configuration, credential
 722   * RE-RESOLVED because you asked" — and they will diverge before they converge.
 723   */
 724  export const relaunchResponseSchema = z.union([
 725    attachResponseSchema,
 726    z.object({ ok: z.literal(false), reason: z.string() })
 727  ])
 728  export type RelaunchResponse = z.infer<typeof relaunchResponseSchema>
 729  
 730  export const launchContextResponseSchema = z.object({
 731    projectRoot: z.string().min(1),
 732    /** recent launch cwds, newest first, deduped, capped at 10 in main */
 733    recentCwds: z.array(z.string()),
 734    /** 2-2: git toplevel of projectRoot (resolveRepoRoot's forward-slash form);
 735     *  null when the project root is not inside a git repo — the dialog then
 736     *  offers only current-tree (findings risk 3). */
 737    repoRoot: z.string().nullable(),
 738    /** 2-2: OTHER live sessions whose cwd resolves to repoRoot (D26f). */
 739    liveSessionsInRepo: z.number().int(),
 740    /** 2-2: main's dialog default (D26f) — a suggestion, never an override. */
 741    suggestedMode: workspaceModeSchema,
 742    /** 2-2: attachable worktrees for the existing-worktree picker. */
 743    worktrees: z.array(pickableWorktreeSchema),
 744    /** Task 3a-5: the picker's rows, resolved and ordered by label in MAIN.
 745     *  They ride in on the existing launch-context call — no fifth round trip. */
 746    launchProfiles: z.array(launchProfileWireSchema),
 747    /** Task 3a-5: the PER-PROJECT last-used pointer, or null when there is none
 748     *  or when it DANGLES (the profile was deleted). Computed in MAIN: the
 749     *  renderer never derives a default and never persists one, and a dangling
 750     *  pointer resolves to "no default" rather than to a fuzzy label match. */
 751    lastLaunchProfileId: z.uuid().nullable()
 752  })
 753  export type LaunchContextResponse = z.infer<typeof launchContextResponseSchema>
 754  
 755  /* ------------------------------------------------------------------ */
 756  /* Task 2-3: cleanup flows + retained-worktree panel (D26 clauses 5-8) */
 757  /* ------------------------------------------------------------------ */
 758  
 759  export const worktreeListRequestSchema = z.object({ project_id: z.uuid() })
 760  export type WorktreeListRequest = z.infer<typeof worktreeListRequestSchema>
 761  
 762  /** One row for the retained-worktree panel (risk 6 columns + prune
 763   *  surfacing). `isPruneCandidate` is recomputed LIVE at list time (2-1's
 764   *  reconcile never persists surface findings): the directory is gone while
 765   *  the row/git metadata remains (population 2), or the entry is a surfaced
 766   *  orphan directory (population 5, nil-uuid sentinel id). `ahead`/`behind`
 767   *  are -1 when not computable — adopted rows carry empty branch/base_branch
 768   *  and an empty ref fails rev-list (the panel renders — instead). */
 769  export const worktreeSummarySchema = z.object({
 770    id: z.uuid(),
 771    path: z.string(),
 772    branch: z.string(),
 773    status: z.string(),
 774    clean: z.boolean(),
 775    dirtyCount: z.number().int(),
 776    ahead: z.number().int(),
 777    behind: z.number().int(),
 778    isPruneCandidate: z.boolean()
 779  })
 780  export type WorktreeSummary = z.infer<typeof worktreeSummarySchema>
 781  
 782  export const worktreeListResponseSchema = z.array(worktreeSummarySchema)
 783  export type WorktreeListResponse = z.infer<typeof worktreeListResponseSchema>
 784  
 785  export const worktreeRemoveRequestSchema = z.object({
 786    worktreeId: z.uuid(),
 787    /** opt-in ONLY (D26 Q4) — default false; branches are never auto-deleted. */
 788    deleteBranch: z.boolean().optional(),
 789    /** required to equal the worktree path for a DIRTY removal (D26 clause 6).
 790     *  It licenses nothing else — F21 split the -D escalation off into its own
 791     *  token below. */
 792    confirmation: z.string().optional(),
 793    /** F21: a SEPARATE acknowledgment from `confirmation`, required before main
 794     *  will ever pass `force: true` to branchDelete. D26(j) said "the same typed
 795     *  confirmation"; that overloaded one token to license two different
 796     *  destructions — uncommitted FILES (confirmation, naming the path) and
 797     *  unmerged COMMITS (this, naming the branch). They are now distinct, so
 798     *  neither can stand in for the other. */
 799    branchForceConfirmation: z.string().optional()
 800  })
 801  export type WorktreeRemoveRequest = z.infer<typeof worktreeRemoveRequestSchema>
 802  
 803  export const worktreeRemoveResponseSchema = z.union([
 804    z.object({ ok: z.literal(true) }),
 805    z.object({ ok: z.literal(false), reason: z.string() })
 806  ])
 807  export type WorktreeRemoveResponse = z.infer<typeof worktreeRemoveResponseSchema>
 808  
 809  export const worktreeDirtyFilesRequestSchema = z.object({ worktreeId: z.uuid() })
 810  export type WorktreeDirtyFilesRequest = z.infer<typeof worktreeDirtyFilesRequestSchema>
 811  
 812  export const worktreeDirtyFilesResponseSchema = z.array(z.string())
 813  export type WorktreeDirtyFilesResponse = z.infer<typeof worktreeDirtyFilesResponseSchema>
 814  
 815  /** The D26 clause-6 confirmation gate, factored pure for the unit test (the
 816   *  worktree:remove handler is the authority; the panel mirrors it). A clean
 817   *  worktree removes without confirmation; a dirty one removes only when the
 818   *  typed token exactly matches its path. */
 819  export function dirtyRemovalAllowed(
 820    wt: { path: string; clean: boolean },
 821    confirmation: string | undefined
 822  ): boolean {
 823    if (wt.clean) return true
 824    return confirmation === wt.path
 825  }
 826  
 827  /** The F21 branch-force gate, factored pure for the unit test (the
 828   *  worktree:remove handler is the authority). `-D` destroys unmerged commits,
 829   *  so it is licensed ONLY by an acknowledgment naming the BRANCH — never by
 830   *  the dirty-removal path token, and never by its absence. The empty-branch
 831   *  guard is load-bearing: adopted rows (population 4) are born with
 832   *  `branch = ''`, and without it an empty-string ack would be `'' === ''` —
 833   *  licensing a force-delete of a nameless branch. */
 834  export function branchForceAllowed(
 835    wt: { branch: string },
 836    ack: string | undefined
 837  ): boolean {
 838    if (wt.branch === '') return false
 839    return ack === wt.branch
 840  }
 841  
 842  /* ------------------------------------------------------------------ */
 843  /* Task 2-4: diff summary (read-only; F18a worktree resolution)        */
 844  /* ------------------------------------------------------------------ */
 845  
 846  export const worktreeDiffRequestSchema = z.object({ sessionId: z.uuid() })
 847  export type WorktreeDiffRequest = z.infer<typeof worktreeDiffRequestSchema>
 848  
 849  /** `{filesChanged, insertions, deletions}` come from `git diff --shortstat
 850   *  HEAD` in the worktree (tracked changes vs HEAD); `untracked` counts `??`
 851   *  lines in `git status --porcelain`. Read-only — the channel never stages,
 852   *  commits, merges, or removes anything. */
 853  export const worktreeDiffSummarySchema = z.object({
 854    filesChanged: z.number().int(),
 855    insertions: z.number().int(),
 856    deletions: z.number().int(),
 857    untracked: z.number().int()
 858  })
 859  export type WorktreeDiffSummary = z.infer<typeof worktreeDiffSummarySchema>
 860  
 861  /** null when the session has no worktree (current-tree), the worktree row is
 862   *  gone, or its directory no longer exists — the pane shows no counts. */
 863  export const worktreeDiffResponseSchema = worktreeDiffSummarySchema.nullable()
 864  export type WorktreeDiffResponse = z.infer<typeof worktreeDiffResponseSchema>
 865  
 866  /* ------------------------------------------------------------------ */
 867  /* Task 3-2: providers + credential vault (D33)                        */
 868  /*                                                                     */
 869  /* The security shape of this surface is the deliverable:              */
 870  /*  1. WRITE-ONLY INBOUND — `key` exists on exactly two request        */
 871  /*     schemas (create/replace) and on NO response schema. A handler   */
 872  /*     that forgets fails the OUTBOUND parse loudly instead of leaking */
 873  /*     quietly (D33 clause 3).                                         */
 874  /*  2. THE SALTED KEY DIGEST NEVER LEAVES MAIN (D33 resolution b) — no       */
 875  /*     schema here admits the digest column; duplicate disambiguation is the */
 876  /*     mandatory label's job.                                                */
 877  /*  3. No masked preview, no hint, no length — clause 3 admits no      */
 878  /*     exception.                                                      */
 879  /* ------------------------------------------------------------------ */
 880  
 881  /** A provider_configs row as it crosses IPC: NON-SECRET metadata only (D33
 882   *  resolution e documents base_url / extra_headers_json as non-secret; the
 883   *  credential envelope's own values override them at launch). snake_case
 884   *  column names on the wire, same convention as projectSchema.root_path.
 885   *  Nullable fields are required-nullable (the house discipline since 1b-1). */
 886  export const providerConfigSchema = z.object({
 887    id: z.uuid(),
 888    name: z.string().min(1).max(120),
 889    adapter_type: z.string().min(1).max(60),
 890    auth_mode: z.string().min(1).max(60),
 891    env_var_name: z.string().max(120).nullable(),
 892    base_url: z.string().max(2048).nullable(),
 893    extra_headers_json: z.string().max(8192).nullable(),
 894    /** D48 (migration v6): the route's DEFAULT model id. Nullable — a
 895     *  subscription route has no model to name. NOT a catalog entry: one
 896     *  hand-entered scalar per route, no list, no fetch, no refresh. */
 897    model: z.string().max(200).nullable(),
 898    created_at: z.string()
 899  })
 900  export type ProviderConfig = z.infer<typeof providerConfigSchema>
 901  
 902  export const providerListRequestSchema = z.object({})
 903  export type ProviderListRequest = z.infer<typeof providerListRequestSchema>
 904  
 905  export const providerListResponseSchema = z.array(providerConfigSchema)
 906  export type ProviderListResponse = z.infer<typeof providerListResponseSchema>
 907  
 908  export const providerCreateRequestSchema = z.object({
 909    name: z.string().min(1).max(120),
 910    /** Plain TEXT this task (3-2) — nothing validates it against an adapter
 911     *  registry until Task 3-3. */
 912    adapter_type: z.string().min(1).max(60),
 913    auth_mode: z.string().min(1).max(60),
 914    env_var_name: z.string().min(1).max(120).optional(),
 915    base_url: z.string().min(1).max(2048).optional(),
 916    /** Plaintext and documented non-secret — main runs it through scrubSecrets
 917     *  and REFUSES if it carries a known key shape (spec §6.4). */
 918    extra_headers_json: z.string().min(1).max(8192).optional(),
 919    /** D48: the route's default model id (optional; hand-entered). */
 920    model: z.string().min(1).max(200).optional()
 921  })
 922  export type ProviderCreateRequest = z.infer<typeof providerCreateRequestSchema>
 923  
 924  export const providerCreateResponseSchema = z.union([
 925    z.object({ ok: z.literal(true), provider: providerConfigSchema }),
 926    z.object({ ok: z.literal(false), reason: z.string() })
 927  ])
 928  export type ProviderCreateResponse = z.infer<typeof providerCreateResponseSchema>
 929  
 930  /** Patch semantics: absent = unchanged; null = clear (nullable fields only);
 931   *  a value = set. Non-nullable columns reject null outright. */
 932  export const providerUpdateRequestSchema = z.object({
 933    id: z.uuid(),
 934    name: z.string().min(1).max(120).optional(),
 935    adapter_type: z.string().min(1).max(60).optional(),
 936    auth_mode: z.string().min(1).max(60).optional(),
 937    env_var_name: z.string().min(1).max(120).nullable().optional(),
 938    base_url: z.string().min(1).max(2048).nullable().optional(),
 939    extra_headers_json: z.string().min(1).max(8192).nullable().optional(),
 940    model: z.string().min(1).max(200).nullable().optional()
 941  })
 942  export type ProviderUpdateRequest = z.infer<typeof providerUpdateRequestSchema>
 943  
 944  export const providerUpdateResponseSchema = z.union([
 945    z.object({ ok: z.literal(true) }),
 946    z.object({ ok: z.literal(false), reason: z.string() })
 947  ])
 948  export type ProviderUpdateResponse = z.infer<typeof providerUpdateResponseSchema>
 949  
 950  
 951  export const providerDeleteRequestSchema = z.object({ id: z.uuid() })
 952  export type ProviderDeleteRequest = z.infer<typeof providerDeleteRequestSchema>
 953  
 954  export const providerDeleteResponseSchema = z.union([
 955    z.object({ ok: z.literal(true) }),
 956    z.object({ ok: z.literal(false), reason: z.string() })
 957  ])
 958  export type ProviderDeleteResponse = z.infer<typeof providerDeleteResponseSchema>
 959  
 960  /** D33 clause 3 — the shape that leaves main. There is NO encrypted_blob and
 961   *  NO key-digest column here, and that absence is the enforcement mechanism:
 962   *  every credential handler outbound-parses through this schema, so a handler
 963   *  that returns a raw row fails loudly instead of leaking quietly. Adding a
 964   *  secret-bearing field to this schema is the one change reviewers must refuse.
 965   *  F-5b (D36 chore): `.strict()` makes "fails loudly" literal — zod's default
 966   *  silently STRIPS unknown keys, which would let a raw row pass with its
 967   *  digest/blob dropped unnoticed; strict throws on them instead. */
 968  export const credentialProfileMetaSchema = z
 969    .object({
 970      id: z.uuid(),
 971      providerId: z.uuid(),
 972      label: z.string().min(1).max(120),
 973      createdAt: z.string(),
 974      lastVerifiedAt: z.string().nullable(),
 975      unavailableSince: z.string().nullable()
 976    })
 977    .strict()
 978  export type CredentialProfileMetaWire = z.infer<typeof credentialProfileMetaSchema>
 979  
 980  export const credentialListRequestSchema = z.object({})
 981  export type CredentialListRequest = z.infer<typeof credentialListRequestSchema>
 982  
 983  export const credentialListResponseSchema = z.array(credentialProfileMetaSchema)
 984  export type CredentialListResponse = z.infer<typeof credentialListResponseSchema>
 985  
 986  export const credentialCreateRequestSchema = z.object({
 987    providerId: z.uuid(),
 988    label: z.string().min(1).max(120),
 989    /** The plaintext key. This is the ONLY field in the entire IPC surface that
 990     *  ever carries key material, and it travels in ONE direction. There is no
 991     *  corresponding response field, by design. Bounded to keep a pathological
 992     *  payload from becoming a memory event; 8 KiB is far above any real key and
 993     *  far below anything worth worrying about. */
 994    key: z.string().min(1).max(8192),
 995    baseUrl: z.string().min(1).max(2048).optional(),
 996    /** Encrypted into the envelope alongside the key — correct by construction. */
 997    extraHeaders: z.record(z.string(), z.string().max(2048)).optional()
 998  })
 999  export type CredentialCreateRequest = z.infer<typeof credentialCreateRequestSchema>
1000  
1001  /** create returns ONLY the new id (write-only inbound, D33 clause 3); failure
1002   *  is the inline-failure idiom Task 2-2 established, so the future dialog
1003   *  renders refusals without an exception path. */
1004  export const credentialCreateResponseSchema = z.union([
1005    z.object({ ok: z.literal(true), id: z.uuid() }),
1006    z.object({ ok: z.literal(false), reason: z.string() })
1007  ])
1008  export type CredentialCreateResponse = z.infer<typeof credentialCreateResponseSchema>
1009  
1010  export const credentialReplaceRequestSchema = z.object({
1011    id: z.uuid(),
1012    key: z.string().min(1).max(8192),
1013    baseUrl: z.string().min(1).max(2048).optional(),
1014    extraHeaders: z.record(z.string(), z.string().max(2048)).optional()
1015  })
1016  export type CredentialReplaceRequest = z.infer<typeof credentialReplaceRequestSchema>
1017  
1018  export const credentialReplaceResponseSchema = z.union([
1019    z.object({ ok: z.literal(true) }),
1020    z.object({ ok: z.literal(false), reason: z.string() })
1021  ])
1022  export type CredentialReplaceResponse = z.infer<typeof credentialReplaceResponseSchema>
1023  
1024  export const credentialDeleteRequestSchema = z.object({ id: z.uuid() })
1025  export type CredentialDeleteRequest = z.infer<typeof credentialDeleteRequestSchema>
1026  
1027  export const credentialDeleteResponseSchema = z.union([
1028    z.object({ ok: z.literal(true) }),
1029    z.object({ ok: z.literal(false), reason: z.string() })
1030  ])
1031  export type CredentialDeleteResponse = z.infer<typeof credentialDeleteResponseSchema>
1032  
1033  /** Task 3-6: the test-key probe (D33 resolution d). Request is a profile id;
1034   *  the response is a boolean plus a SANITIZED message — no response body, no
1035   *  exception text, no field capable of carrying key material (the unit test
1036   *  asserts the key set, same discipline as this file's meta schema). */
1037  export const credentialTestRequestSchema = z.object({ id: z.uuid() })
1038  export type CredentialTestRequest = z.infer<typeof credentialTestRequestSchema>
1039  
1040  export const credentialTestResponseSchema = z.union([
1041    z.object({ ok: z.literal(true) }),
1042    z.object({ ok: z.literal(false), reason: z.string() })
1043  ])
1044  export type CredentialTestResponse = z.infer<typeof credentialTestResponseSchema>
1045  
1046  /* ------------------------------------------------------------------ */
1047  /* Task 3a-4: the model catalog (migration v9)                         */
1048  /*                                                                     */
1049  /* ⚠ A LIST OF WHAT EXISTS, NOT AN AUTHORITY. Nothing on this wire can  */
1050  /* instruct main to change a route's default model: there is no field   */
1051  /* for it, in either direction, and that absence is the enforcement.    */
1052  /* The precedence order is launch_profiles.model (3a-5) >              */
1053  /* provider_configs.model (v6, D48) > nothing; model_catalog is not in  */
1054  /* it. See the v9 migration comment in storage.ts.                      */
1055  /* ------------------------------------------------------------------ */
1056  
1057  /** The three freshness states, COMPUTED IN MAIN. The renderer does no date
1058   *  arithmetic — a renderer-side threshold would be a second home for the
1059   *  policy. `'never'` is a third state, not a flavour of `'stale'`. */
1060  export const catalogFreshnessSchema = z.enum(['never', 'fresh', 'stale'])
1061  export type CatalogFreshnessWire = z.infer<typeof catalogFreshnessSchema>
1062  
1063  /** One catalogued model. `.strict()` for the F-5b reason: zod otherwise
1064   *  STRIPS unknown keys silently, which would let a raw row pass with extra
1065   *  columns dropped unnoticed. There is no field here capable of carrying key
1066   *  material, and adding one is the change reviewers must refuse. */
1067  export const modelCatalogEntrySchema = z
1068    .object({
1069      modelId: z.string().min(1).max(200),
1070      displayName: z.string().max(200),
1071      /** Stored and DISPLAYED, never reasoned over (explicit non-goal). */
1072      contextLength: z.number().int().nullable(),
1073      expiresAt: z.string().nullable(),
1074      /** Set once when a refresh stops seeing the id; never moved while it stays
1075       *  missing; cleared when it returns. The row is never deleted. */
1076      missingSince: z.string().nullable()
1077    })
1078    .strict()
1079  export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>
1080  
1081  export const modelListRequestSchema = z.object({ provider_id: z.uuid() })
1082  export type ModelListRequest = z.infer<typeof modelListRequestSchema>
1083  
1084  export const modelListResponseSchema = z
1085    .object({
1086      models: z.array(modelCatalogEntrySchema),
1087      /** MAX(refreshed_at) over the provider's rows; null = never refreshed. */
1088      refreshedAt: z.string().nullable(),
1089      freshness: catalogFreshnessSchema,
1090      /**
1091       * D85 (Task 3d-2): the ids the USER shortlisted for this route, in the
1092       * order they added them.
1093       *
1094       * ⚠ A FLAT ARRAY BESIDE `models`, NOT A `shortlisted` FLAG ON EACH ENTRY,
1095       * and the difference is load-bearing. A flag could only ever describe ids
1096       * the catalog currently holds — so a shortlisted model that went missing,
1097       * or that a refresh never returned, would vanish from the user's own list
1098       * the moment the provider stopped mentioning it. The shortlist is user
1099       * intent and outlives the cache (v12), so it crosses the wire as its own
1100       * fact. Rendering the intersection is the renderer's job; deciding what
1101       * the user chose is not.
1102       */
1103      shortlist: z.array(z.string().min(1).max(200))
1104    })
1105    .strict()
1106  export type ModelListResponse = z.infer<typeof modelListResponseSchema>
1107  
1108  /** D85: add or remove ONE id from a route's shortlist. Idempotent in both
1109   *  directions, so the renderer may send the desired state rather than a
1110   *  toggle — a toggle would double-fire under a double click and silently
1111   *  undo itself. */
1112  export const modelShortlistSetRequestSchema = z
1113    .object({
1114      provider_id: z.uuid(),
1115      /** NOT constrained to the catalog. A user may shortlist an id no refresh
1116       *  has ever returned — the same freedom D48/D56 protect by keeping the
1117       *  model input free text with a `<datalist>` rather than a `<select>`. */
1118      model_id: z.string().min(1).max(200),
1119      shortlisted: z.boolean()
1120    })
1121    .strict()
1122  export type ModelShortlistSetRequest = z.infer<typeof modelShortlistSetRequestSchema>
1123  
1124  /** The provider's shortlist AFTER the write, so the renderer never rebuilds
1125   *  the list from its own optimistic guess about what it just sent. */
1126  export const modelShortlistSetResponseSchema = z.union([
1127    z.object({ ok: z.literal(true), shortlist: z.array(z.string().min(1).max(200)) }).strict(),
1128    z.object({ ok: z.literal(false), reason: z.string() }).strict()
1129  ])
1130  export type ModelShortlistSetResponse = z.infer<typeof modelShortlistSetResponseSchema>
1131  
1132  /** `credential_id` is a PROFILE ID or null — never a key. Null is the
1133   *  unauthenticated path, a shipped behaviour rather than a fallback. */
1134  export const modelRefreshRequestSchema = z.object({
1135    provider_id: z.uuid(),
1136    credential_id: z.uuid().nullable()
1137  })
1138  export type ModelRefreshRequest = z.infer<typeof modelRefreshRequestSchema>
1139  
1140  /** ⚠ COUNTS, NEVER LISTS OF IDS in the failure path, and no field capable of
1141   *  carrying key material (D42/D55: a telemetry number never ships without its
1142   *  denominator, enforced by the outbound schema). `.strict()` on both arms. */
1143  export const modelRefreshResponseSchema = z.union([
1144    z
1145      .object({
1146        ok: z.literal(true),
1147        added: z.number().int().nonnegative(),
1148        updated: z.number().int().nonnegative(),
1149        missing: z.number().int().nonnegative(),
1150        /** Rows the provider sent that failed ingest validation. */
1151        dropped: z.number().int().nonnegative(),
1152        refreshedAt: z.string()
1153      })
1154      .strict(),
1155    z.object({ ok: z.literal(false), reason: z.string() }).strict()
1156  ])
1157  export type ModelRefreshResponse = z.infer<typeof modelRefreshResponseSchema>
1158  
1159  /* ------------------------------------------------------------------ */
1160  /* Task 3a-2: attention capture (Mission Control spec §5.3)            */
1161  /*                                                                     */
1162  /* The honesty shape of this surface is the deliverable:               */
1163  /*  1. There is NO `minutes` FIELD. Minutes are DERIVED by the caller  */
1164  /*     from `samples x tickSeconds`, so it is structurally impossible  */
1165  /*     to obtain a number without having been handed its denominator.  */
1166  /*  2. `byClass`, `expectedSamples` and `coveragePct` are REQUIRED —   */
1167  /*     a denominator-less response fails the outbound .parse in main   */
1168  /*     rather than shipping a bare figure (the D33 clause-3 move,      */
1169  /*     applied to a different kind of dangerous value).                */
1170  /*  3. `estimateBound` states the direction of the bias as a FIELD, so */
1171  /*     a consumer rendering this record cannot render the number       */
1172  /*     without the qualifier travelling beside it.                     */
1173  /* ------------------------------------------------------------------ */
1174  
1175  /** Mirrors `AttentionClass` in main/services/attentionCore.ts — the classifier
1176   *  owns the vocabulary, this is its wire form (the adapters/types.ts pattern). */
1177  export const attentionClassSchema = z.enum(['pane', 'overhead', 'blurred', 'idle', 'locked'])
1178  export type AttentionClassWire = z.infer<typeof attentionClassSchema>
1179  
1180  /**
1181   * attention:report — the renderer's half of §5.3's first clause. Sent only on a
1182   * real edge (see renderer/src/attention/reporter.ts), never on a timer.
1183   *
1184   * `sessionId` is deliberately NOT FK-checked in main, exactly as `view:set`'s
1185   * `focusedSessionId` is not (F4): a report can legitimately name a session main
1186   * has just seen exit, and throwing would break a fire-and-forget send.
1187   */
1188  export const attentionReportSchema = z
1189    .object({
1190      /** The active project, or null — nothing to attribute to (table row 12). */
1191      projectId: z.uuid().nullable(),
1192      /** The session whose TERMINAL HOST holds DOM focus; null for chrome
1193       *  (tab bar, header buttons, filmstrip cards, splitter, body). */
1194      sessionId: z.uuid().nullable(),
1195      /** ⚠ WIDENED BY 3b-4 TO CARRY `council`, and reporting it as `settings`
1196       *  would have been the cheaper lie. Every non-workspace view classifies as
1197       *  `overhead` (attentionCore.classify) — the CLASS would have been right
1198       *  either way, but this field is a fact about where the user was, and a
1199       *  telemetry field that is confidently wrong is worse than one that is
1200       *  coarse. The class vocabulary is untouched, so there is no migration.
1201       *
1202       *  ⚠ WIDENED AGAIN FOR `project-settings`, ON EXACTLY THE PRECEDENT ABOVE.
1203       *  Folding it into `settings` would be the same cheap lie 3b-4 refused:
1204       *  they are different screens reached different ways, and one of them is a
1205       *  step in creating a project. `classify()` still returns `overhead` for
1206       *  everything that is not `workspace`, so no class, no row and no query
1207       *  changes — only the label on the fact gets more honest. */
1208      view: z.enum(['workspace', 'settings', 'project-settings', 'council']),
1209      /**
1210       * ⚠ D95 / Task 3e-3 — A RESHAPE OF THIS EXISTING PAYLOAD, **NOT A NEW
1211       * CHANNEL.** `IpcChannel` stays where 3e-4 left it; nothing is added here
1212       * but a field, and it is declared the way D80 declared its reshape.
1213       *
1214       * The project the COUNCIL VIEW is bound to. **Null unless `view` is
1215       * `'council'` AND a project is selected** — the renderer must not leak an
1216       * attribution out of a view that is not doing the work, so it is sent as
1217       * null from every other view rather than being filtered in main.
1218       *
1219       * ⚠ IT IS NOT A DUPLICATE OF `projectId` EVEN THOUGH IT EQUALS IT TODAY.
1220       * `projectId` answers "which project is active"; this answers "is the
1221       * council working, and for whom" — and `classify()` needs the second
1222       * question, because a project being active says nothing about whether a
1223       * deliberation is running for it.
1224       */
1225      councilProjectId: z.uuid().nullable(),
1226      /** Launch dialog / command palette / worktree panel. Checked BEFORE
1227       *  sessionId in classify(): an overlay can own the keyboard while a
1228       *  terminal underneath still holds DOM focus. */
1229      overlayOpen: z.boolean()
1230    })
1231    .strict()
1232  export type AttentionReport = z.infer<typeof attentionReportSchema>
1233  
1234  export const attentionSummaryRequestSchema = z.object({
1235    project_id: z.uuid(),
1236    /** ISO instants bounding the window. Spans OVERLAPPING it are returned. */
1237    from: z.string().min(1),
1238    to: z.string().min(1)
1239  })
1240  export type AttentionSummaryRequest = z.infer<typeof attentionSummaryRequestSchema>
1241  
1242  /** All five classes are REQUIRED. A histogram missing a class is a histogram
1243   *  that cannot be checked against the accounting identity, so it does not
1244   *  parse. `.strict()` for the F-5b reason: zod silently STRIPS unknown keys. */
1245  export const attentionByClassSchema = z
1246    .object({
1247      pane: z.number().int().nonnegative(),
1248      overhead: z.number().int().nonnegative(),
1249      blurred: z.number().int().nonnegative(),
1250      idle: z.number().int().nonnegative(),
1251      locked: z.number().int().nonnegative()
1252    })
1253    .strict()
1254  export type AttentionByClass = z.infer<typeof attentionByClassSchema>
1255  
1256  /** Per-session pane samples. `samples`, not minutes — same rule, one level in. */
1257  export const attentionSessionSamplesSchema = z
1258    .object({
1259      sessionId: z.string().min(1),
1260      samples: z.number().int().nonnegative()
1261    })
1262    .strict()
1263  
1264  export const attentionSummaryResponseSchema = z
1265    .object({
1266      projectId: z.uuid(),
1267      from: z.string(),
1268      to: z.string(),
1269      /** THE DENOMINATOR — required, and it sums to `samples`. */
1270      byClass: attentionByClassSchema,
1271      samples: z.number().int().nonnegative(),
1272      /** The cadence samples are expressed in. Minutes = samples x this / 60. */
1273      tickSeconds: z.number().int().positive(),
1274      /** Ticks the sampler SHOULD have produced across the window the returned
1275       *  spans envelope; divergence means the app was down or suspended. */
1276      expectedSamples: z.number().int().nonnegative(),
1277      missingSamples: z.number().int().nonnegative(),
1278      coveragePct: z.number().min(0),
1279      /** Pane samples per session. Overhead is byClass.overhead — it has no
1280       *  session by construction (§5.3's per-project bucket). */
1281      bySession: z.array(attentionSessionSamplesSchema),
1282      /** ALWAYS 'lower-bound'. Attention is undercounted BY CONSTRUCTION: a long
1283       *  read past 60 s of no input stops counting, and work done outside the
1284       *  Chorus window is `blurred` rather than attributed. Present as a field so
1285       *  the qualifier cannot be separated from the number. */
1286      estimateBound: z.literal('lower-bound')
1287    })
1288    .strict()
1289  export type AttentionSummary = z.infer<typeof attentionSummaryResponseSchema>
1290  
1291  /* ------------------------------------------------------------------ */
1292  /* Task 3a-3: "% of spend attributed" (D42, Mission Control spec §5.1) */
1293  /*                                                                     */
1294  /* The honesty shape of this surface is, again, the deliverable — and  */
1295  /* D55 binds it exactly as it bound 3a-2:                              */
1296  /*  1. NEITHER RATIO MAY BE READ ALONE. `attributedUsd`,               */
1297  /*     `gatewayTotalUsd`, `attributedDispatches`, `totalDispatches`    */
1298  /*     and `subscriptionDispatches` are ALL REQUIRED, so a             */
1299  /*     denominator-less response fails the outbound .parse in main     */
1300  /*     rather than shipping a bare percentage that will be believed.   */
1301  /*  2. `spendBasis` states the SCOPE of the dollar figure as a FIELD,  */
1302  /*     so a consumer cannot render the number without the qualifier    */
1303  /*     travelling beside it — 3a-2's `estimateBound` move, applied to  */
1304  /*     the other honesty gap D42 names.                                */
1305  /*  3. `tokensSourceBreakdown` says how many rows' tokens were         */
1306  /*     MEASURED versus DERIVED (§8). A derived number labelled as      */
1307  /*     derived is fine; labelled as measured it is not.                */
1308  /*  4. NO FIELD CAN CARRY KEY MATERIAL. There is no key, no hash, no   */
1309  /*     label, no profile id — and `.strict()` means one cannot be      */
1310  /*     added by accident, because zod silently STRIPS unknown keys     */
1311  /*     (F-5b) and a stripped field is an invisible one.                */
1312  /* ------------------------------------------------------------------ */
1313  
1314  export const attributionSummaryRequestSchema = z.object({
1315    /** ISO instants bounding the window. Dispatches STARTED inside it count. */
1316    from: z.string().min(1),
1317    to: z.string().min(1)
1318  })
1319  export type AttributionSummaryRequest = z.infer<typeof attributionSummaryRequestSchema>
1320  
1321  /** How each row's token numbers were obtained. Sums to the row count that had
1322   *  any attribution attempted, so the derived share is checkable rather than
1323   *  asserted. */
1324  export const tokensSourceBreakdownSchema = z
1325    .object({
1326      analytics: z.number().int().nonnegative(),
1327      analyticsDerived: z.number().int().nonnegative(),
1328      cliLogs: z.number().int().nonnegative(),
1329      unknown: z.number().int().nonnegative()
1330    })
1331    .strict()
1332  export type TokensSourceBreakdown = z.infer<typeof tokensSourceBreakdownSchema>
1333  
1334  export const attributionSummaryResponseSchema = z
1335    .object({
1336      from: z.string(),
1337      to: z.string(),
1338      /** attributedUsd / gatewayTotalUsd. NULL when the total is unknown or
1339       *  zero — never 0, never NaN. */
1340      spendPct: z.number().nullable(),
1341      /** attributedDispatches / totalDispatches. NULL on a zero-dispatch
1342       *  window — never 0. */
1343      dispatchPct: z.number().nullable(),
1344      /* ---- THE DENOMINATORS. All required. ---- */
1345      attributedUsd: z.number(),
1346      unattributedUsd: z.number().nullable(),
1347      gatewayTotalUsd: z.number().nullable(),
1348      totalDispatches: z.number().int().nonnegative(),
1349      attributedDispatches: z.number().int().nonnegative(),
1350      /** ⚠ COUNTED, NEVER PRICED. A flat-rate subscription has no honest
1351       *  $/token rate, and inventing one would fabricate precisely the number
1352       *  D42 wants made visible. */
1353      subscriptionDispatches: z.number().int().nonnegative(),
1354      tokensSourceBreakdown: tokensSourceBreakdownSchema,
1355      /** ALWAYS 'gateway-only'. The dollar figure can see OpenRouter spend and
1356       *  nothing else; subscription work contributes zero dollars BY DESIGN,
1357       *  not by omission. Present as a field so the qualifier cannot be
1358       *  separated from the number. */
1359      spendBasis: z.literal('gateway-only'),
1360      /** Whether a management key is configured at all. Without one, `spendPct`
1361       *  is null for a reason a caller would otherwise have to guess at. */
1362      managementKeyConfigured: z.boolean()
1363    })
1364    .strict()
1365  export type AttributionSummary = z.infer<typeof attributionSummaryResponseSchema>
1366  
1367  export const writeRequestSchema = z.object({
1368    sessionId: z.string().min(1),
1369    data: z.string()
1370  })
1371  export type WriteRequest = z.infer<typeof writeRequestSchema>
1372  
1373  export const resizeRequestSchema = z.object({
1374    sessionId: z.string().min(1),
1375    cols: z.number().int().min(1).max(1000),
1376    rows: z.number().int().min(1).max(1000)
1377  })
1378  export type ResizeRequest = z.infer<typeof resizeRequestSchema>
1379  
1380  export const killRequestSchema = z.object({
1381    sessionId: z.string().min(1)
1382  })
1383  export type KillRequest = z.infer<typeof killRequestSchema>
1384  
1385  export const sessionDataEventSchema = z.object({
1386    sessionId: z.string().min(1),
1387    data: z.string()
1388  })
1389  export type SessionDataEvent = z.infer<typeof sessionDataEventSchema>
1390  
1391  export const sessionExitEventSchema = z.object({
1392    sessionId: z.string().min(1),
1393    exitCode: z.number().int()
1394  })
1395  export type SessionExitEvent = z.infer<typeof sessionExitEventSchema>
1396  
1397  export const cliDetectRequestSchema = z.object({})
1398  export type CliDetectRequest = z.infer<typeof cliDetectRequestSchema>
1399  
1400  export const detectedCliSchema = z.object({
1401    name: z.string().min(1),
1402    found: z.boolean(),
1403    /** resolved location on disk (the .exe or the npm shim), null when not found */
1404    path: z.string().nullable(),
1405    /** first line of `<tool> --version`; 'unknown' when the tool exists but the probe failed */
1406    version: z.string().nullable(),
1407    /** D34(f): adapter-supplied label for agent entries; null for plain tool
1408     *  probes (git/docker/node). Required-nullable so a producer that forgets it
1409     *  fails the outbound parse (the 1b-1 `title` discipline). */
1410    displayName: z.string().nullable(),
1411    /** D34(f): the AgentKind when this row IS an agent; null when it is a plain
1412     *  tool. A TYPED value rather than the `agent: boolean` flag D34(f) sketched
1413     *  — the renderer needs an AgentKind for the launch payload, and a boolean
1414     *  would force a cast at exactly the boundary this refactor exists to type. */
1415    agentKind: agentKindSchema.nullable()
1416  })
1417  export type DetectedCli = z.infer<typeof detectedCliSchema>
1418  
1419  export const cliDetectResponseSchema = z.array(detectedCliSchema)
1420  export type CliDetectResponse = z.infer<typeof cliDetectResponseSchema>
1421  
1422  /* ------------------------------------------------------------------ */
1423  /* Task 3-3: adapter declarations on the wire (D34)                    */
1424  /*                                                                     */
1425  /* cli:detect stays the INSTALLATION probe (found / path / version,    */
1426  /* plus D34(f) display data). adapter:list is the STATIC DECLARATION   */
1427  /* (id, displayName, executionMode, auth methods, capabilities) — a    */
1428  /* coordinator addition beyond D34(f), so Task 3-4's provider form     */
1429  /* renders auth methods from the wire instead of hardcoding them in a  */
1430  /* Vue file (the coupling D34(f) exists to remove, one layer up).      */
1431  /* These schemas mirror src/main/adapters/types.ts; descriptors use    */
1432  /* required-nullable for the "declared but absent" case, matching the  */
1433  /* interface's `| null`.                                               */
1434  /* ------------------------------------------------------------------ */
1435  
1436  export const descriptorModeSchema = z.enum(['static', 'dynamic'])
1437  export type DescriptorModeWire = z.infer<typeof descriptorModeSchema>
1438  
1439  /**
1440   * Task 3a-4 — ⚠ `cliFlag: string` was REPLACED by `args: string[]`, not
1441   * supplemented. A single string cannot express what either installed CLI
1442   * needs: claude 2.1.218 wants `['--effort', 'high']` and codex 0.145.0 wants
1443   * `['-c', 'model_reasoning_effort="high"']`. A whitespace split breaks the
1444   * moment a value needs quoting — and codex's values ARE TOML-quoted — while
1445   * the alternative, a per-adapter `switch` in `buildLaunch`, would put the
1446   * mapping in TWO homes in the task whose headline output is a one-home ruling.
1447   *
1448   * The replacement was free at execution: grep-verified 2026-07-25, `cliFlag`
1449   * had ZERO producers and zero real consumers — it appeared only in the type,
1450   * this schema, and two test fixtures. (`ResumeDescriptor.cliFlag` below is a
1451   * DIFFERENT field on a different descriptor and is out of scope.)
1452   *
1453   * `id` is tightened to the four-level vocabulary, which is what makes the
1454   * descriptor itself the mapping table.
1455   */
1456  export const effortOptionSchema = z.object({
1457    id: effortLevelSchema,
1458    label: z.string(),
1459    /** The EXACT argv tokens this level contributes. A flag+value pair and a
1460     *  `-c key=value` override are the same thing at this level of abstraction,
1461     *  which is why this is a token ARRAY and not a string. */
1462    args: z.array(z.string()).min(1)
1463  })
1464  export type EffortOptionWire = z.infer<typeof effortOptionSchema>
1465  
1466  export const effortDescriptorSchema = z.object({
1467    mode: descriptorModeSchema,
1468    levels: z.array(effortOptionSchema)
1469  })
1470  
1471  export const mcpDescriptorSchema = z.object({
1472    mode: descriptorModeSchema,
1473    format: z.enum(['json', 'toml', 'yaml']),
1474    location: z.enum(['project', 'home', 'custom']),
1475    configPath: z.string().nullable()
1476  })
1477  
1478  export const hooksDescriptorSchema = z.object({
1479    mode: descriptorModeSchema,
1480    mechanism: z.enum(['http_listener', 'script', 'file_watch'])
1481  })
1482  
1483  export const resumeDescriptorSchema = z.object({
1484    mode: descriptorModeSchema,
1485    cliFlag: z.string().nullable()
1486  })
1487  
1488  export const agentCapabilitiesSchema = z.object({
1489    interactiveTerminal: z.boolean(),
1490    worktreeSafe: z.boolean(),
1491    skills: z.boolean(),
1492    subscriptionLogin: z.boolean(),
1493    apiKey: z.boolean(),
1494    reasoningEffort: effortDescriptorSchema.nullable(),
1495    sessionResume: resumeDescriptorSchema.nullable(),
1496    mcp: mcpDescriptorSchema.nullable(),
1497    hooks: hooksDescriptorSchema.nullable()
1498  })
1499  export type AgentCapabilitiesWire = z.infer<typeof agentCapabilitiesSchema>
1500  
1501  export const authMethodDefinitionSchema = z.object({
1502    type: z.enum(['subscription', 'api_key']),
1503    label: z.string(),
1504    /** The env var the api_key method injects into (the DEFAULT — a provider's
1505     *  env_var_name overrides it, D34(e)); null for subscription methods. */
1506    requiredEnvVar: z.string().nullable(),
1507    helpUrl: z.string().nullable()
1508  })
1509  export type AuthMethodDefinitionWire = z.infer<typeof authMethodDefinitionSchema>
1510  
1511  /** One adapter's static declaration. NO installation state (that is
1512   *  cli:detect's job) and no secret-adjacent field anywhere. */
1513  export const adapterDescriptorSchema = z.object({
1514    id: z.string(),
1515    displayName: z.string(),
1516    executionMode: z.enum(['pty', 'api']),
1517    authMethods: z.array(authMethodDefinitionSchema),
1518    capabilities: agentCapabilitiesSchema
1519  })
1520  export type AdapterDescriptor = z.infer<typeof adapterDescriptorSchema>
1521  
1522  export const adapterListRequestSchema = z.object({})
1523  export type AdapterListRequest = z.infer<typeof adapterListRequestSchema>
1524  
1525  export const adapterListResponseSchema = z.array(adapterDescriptorSchema)
1526  export type AdapterListResponse = z.infer<typeof adapterListResponseSchema>
1527  
1528  export const layoutGetRequestSchema = z.object({ project_id: z.uuid() })
1529  export type LayoutGetRequest = z.infer<typeof layoutGetRequestSchema>
1530  
1531  /**
1532   * Persisted pane layout: an owned binary split tree (D9 / CR-1.2). Leaves
1533   * bind a stable sessions-row id, never an agent kind. The discriminated union
1534   * on `type` stops an internal node masquerading as a leaf; the tuple enforces
1535   * exactly-2 children at the schema boundary; ratios are bounded on read.
1536   */
1537  const layoutLeafSchema = z.object({
1538    type: z.literal('leaf'),
1539    sessionId: z.string().min(1)
1540  })
1541  
1542  export const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
1543    z.discriminatedUnion('type', [
1544      layoutLeafSchema,
1545      z.object({
1546        type: z.enum(['row', 'column']),
1547        ratio: z.number().min(0.05).max(0.95),
1548        children: z.tuple([layoutNodeSchema, layoutNodeSchema])
1549      })
1550    ])
1551  )
1552  
1553  export const layoutJsonSchema = z.object({
1554    version: z.literal(1),
1555    root: layoutNodeSchema
1556  })
1557  
1558  /** layout:set payload — the target project plus the full layout tree, or a
1559   *  null tree to clear it (Task 1-4: empty layouts are legal; main deletes the
1560   *  pane_layouts row — the row's ABSENCE is the empty signal, never a null-root
1561   *  wrapper). Parsed in main only (D1); ratios are re-clamped there before
1562   *  persist (council D9). */
1563  export const layoutSetRequestSchema = z.object({
1564    project_id: z.uuid(),
1565    layout: layoutJsonSchema.nullable()
1566  })
1567  export type LayoutSetRequest = z.infer<typeof layoutSetRequestSchema>
1568  
1569  export const sessionInfoSchema = z.object({
1570    id: z.string().min(1),
1571    agent: agentKindSchema,
1572    status: sessionStatusSchema,
1573    /** 1b-1: required-nullable, same discipline as attachResponseSchema.title —
1574     *  every view reads the title from the same round-trip. */
1575    title: z.string().nullable(),
1576    /** 1b-2: SessionRow.created_at (ISO text) passes through so filmstrip cards
1577     *  can compute elapsed-since-launch. */
1578    createdAt: z.string(),
1579    /** 1b-2: exit code for the card status dot (exited-ok vs exited-error) —
1580     *  cards never attach, so this row is their ONLY status source. */
1581    exitCode: z.number().int().nullable(),
1582    /** 2-2: worktree branch for card/pane labels, null for current-tree
1583     *  sessions. Required-nullable, same discipline as title. */
1584    branch: z.string().nullable()
1585  })
1586  export type SessionInfo = z.infer<typeof sessionInfoSchema>
1587  
1588  export const layoutGetResponseSchema = z.object({
1589    /** null when the project has no pane_layouts row (fresh DB or last pane
1590     *  closed): the renderer shows the empty state (Task 1-4). */
1591    layout: layoutJsonSchema.nullable(),
1592    sessions: z.array(sessionInfoSchema)
1593  })
1594  export type LayoutGetResponse = z.infer<typeof layoutGetResponseSchema>
1595  
1596  /* ------------------------------------------------------------------ */
1597  /* Task 1b-2: per-project view state (D20)                             */
1598  /* ------------------------------------------------------------------ */
1599  
1600  export const viewModeSchema = z.enum(['filmstrip', 'grid'])
1601  export type ViewMode = z.infer<typeof viewModeSchema>
1602  
1603  /** Per-project workspace view state (D20): which renderer is active and which
1604   *  session the filmstrip focuses. `focusedSessionId` is a nullable string
1605   *  ONLY — never FK-checked against sessions. It legitimately outlives its
1606   *  session (F4); views resolve staleness by falling back to the first leaf.
1607   *  Schema validity ≠ liveness. */
1608  export const viewStateSchema = z.object({
1609    mode: viewModeSchema,
1610    focusedSessionId: z.string().nullable()
1611  })
1612  export type ViewState = z.infer<typeof viewStateSchema>
1613  
1614  export const viewGetRequestSchema = z.object({ project_id: z.uuid() })
1615  export type ViewGetRequest = z.infer<typeof viewGetRequestSchema>
1616  
1617  export const viewSetRequestSchema = z.object({
1618    project_id: z.uuid(),
1619    state: viewStateSchema
1620  })
1621  export type ViewSetRequest = z.infer<typeof viewSetRequestSchema>
1622  
1623  /* ------------------------------------------------------------------ */
1624  /* Task 1-5: project tabs + D16 restore contract                       */
1625  /* ------------------------------------------------------------------ */
1626  
1627  /** A projects-table row as it crosses IPC (snake_case root_path, matching the
1628   *  DB column; main maps its internal ProjectRecord). */
1629  export const projectSchema = z.object({
1630    id: z.uuid(),
1631    name: z.string(),
1632    root_path: z.string(),
1633    /**
1634     * The user's chosen spine colour, or null when they have never chosen one.
1635     *
1636     * ⚠ NULLABLE ON THE WIRE ON PURPOSE, and the renderer must keep honouring it.
1637     * Before migration v13 the rail derived every spine colour from the project's
1638     * LIST INDEX and stored nothing; null is how a pre-v13 row says "I still want
1639     * that", so collapsing this to a non-null column with a back-filled default
1640     * would silently repaint every project that already exists.
1641     */
1642    color: z.string().regex(PROJECT_COLOR_PATTERN).nullable(),
1643    /** Free-text notes. Null when never written. Rendered ONLY on the project
1644     *  settings screen — the rail deliberately has no room for it. */
1645    description: z.string().nullable()
1646  })
1647  export type Project = z.infer<typeof projectSchema>
1648  
1649  /** project:add — the renderer sends nothing; main runs the native directory
1650   *  picker (D3: dialog.showOpenDialog never leaves the main process). */
1651  export const projectAddRequestSchema = z.object({})
1652  export type ProjectAddRequest = z.infer<typeof projectAddRequestSchema>
1653  
1654  export const projectAddResponseSchema = z.union([
1655    z.object({ project: projectSchema }),
1656    z.object({ cancelled: z.literal(true) })
1657  ])
1658  export type ProjectAddResponse = z.infer<typeof projectAddResponseSchema>
1659  
1660  /**
1661   * ⚠ `sessionCount` is Phase 3c's ONE declared payload reshape (D80), and it is
1662   * bounded to this field on this response. The design's project rail shows a
1663   * session count on EVERY project, and nothing else on the wire could supply
1664   * one: sessions reach the renderer only through `getLayout(activeId)`, and the
1665   * layout store holds a single project's tree at a time — so the count was
1666   * available for the active project and no other.
1667   *
1668   * It rides the response `project:list` already returns, computed in main by one
1669   * `GROUP BY project_id` over `sessions`. No channel and no handler was added
1670   * (`IpcChannel` stays 56, `ipcMain.handle(` 51), and no other task in this
1671   * phase may reshape a payload.
1672   *
1673   * ⚠ It sits HERE and not on `projectSchema` deliberately, the same way `active`
1674   * does: both are facts about a project's place in the LIST, not columns of the
1675   * projects row, and `project:add` must keep returning the bare row shape.
1676   */
1677  export const projectsListSchema = z.array(
1678    projectSchema.extend({ active: z.boolean(), sessionCount: z.number().int().nonnegative() })
1679  )
1680  export type ProjectsList = z.infer<typeof projectsListSchema>
1681  
1682  export const projectSelectRequestSchema = z.object({ project_id: z.uuid() })
1683  export type ProjectSelectRequest = z.infer<typeof projectSelectRequestSchema>
1684  
1685  /** The description cap. Enforced HERE — one number, applied on the boundary —
1686   *  rather than by a DB CHECK, so the renderer can show the same limit as a live
1687   *  character counter instead of discovering it as a failed write. */
1688  export const PROJECT_DESCRIPTION_MAX = 1000
1689  
1690  /**
1691   * project:update — the project settings screen saving name + colour +
1692   * description together.
1693   *
1694   * ⚠ THE `color` REGEX IS THE SECURITY BOUNDARY, not a formatting preference.
1695   * The rail interpolates this string into an inline `style` binding, so any
1696   * value that is not exactly `#RRGGBB` is a CSS-injection primitive. It is
1697   * validated in MAIN (D1: Zod runs here, never in the preload — see the
1698   * CSP/EvalError note), which means the renderer can only ever read a
1699   * well-formed colour back out of the database no matter what it sent.
1700   *
1701   * `name` is trimmed and must survive the trim: a whitespace-only name would
1702   * render as an invisible rail item and an empty window title, and there is no
1703   * way back to the settings screen for a project you cannot see.
1704   */
1705  export const projectUpdateRequestSchema = z.object({
1706    project_id: z.uuid(),
1707    name: z.string().trim().min(1).max(120),
1708    color: z.string().regex(PROJECT_COLOR_PATTERN),
1709    /** Empty string is normalised to null by main — "" and NULL must not both be
1710     *  storable, or two rows can mean the same thing and read differently. */
1711    description: z.string().max(PROJECT_DESCRIPTION_MAX)
1712  })
1713  export type ProjectUpdateRequest = z.infer<typeof projectUpdateRequestSchema>
1714  
1715  export const projectUpdateResponseSchema = z.object({ project: projectSchema })
1716  export type ProjectUpdateResponse = z.infer<typeof projectUpdateResponseSchema>
1717  
1718  /** session:restart {sessionId} — D16 clause 4: read row -> re-validate cwd ->
1719   *  launch path under the SAME row id (no row creation); 'running' is written
1720   *  only after the spawn succeeds. One path for in-run and post-restart. */
1721  export const restartRequestSchema = z.object({ sessionId: z.uuid() })
1722  export type RestartRequest = z.infer<typeof restartRequestSchema>
1723  
1724  export const restartResponseSchema = z.union([
1725    attachResponseSchema,
1726    z.object({ ok: z.literal(false), reason: z.string() })
1727  ])
1728  export type RestartResponse = z.infer<typeof restartResponseSchema>
1729  
1730  /** session:delete {sessionId} — pane close, after kill/exit completes. Main
1731   *  rejects the delete while the session is live in the manager. */
1732  export const deleteSessionRequestSchema = z.object({ sessionId: z.uuid() })
1733  export type DeleteSessionRequest = z.infer<typeof deleteSessionRequestSchema>
1734  
1735  /** session:set-title {sessionId, title} — the ONE title write path (1b-1/D18).
1736   *  max(120) bounds the wire size; main additionally strips control characters
1737   *  and no-ops on an empty post-sanitize result. */
1738  export const setTitleRequestSchema = z.object({
1739    sessionId: z.uuid(),
1740    title: z.string().min(1).max(120)
1741  })
1742  export type SetTitleRequest = z.infer<typeof setTitleRequestSchema>
1743  
1744  /** Restore engine relaunched this session (auto-restore only — a manual
1745   *  Restart badges from its own return path). The pane re-attaches and wears
1746   *  the transient "new conversation" badge when the attach comes back running. */
1747  export const sessionRestoredEventSchema = z.object({ sessionId: z.string().min(1) })
1748  export type SessionRestoredEvent = z.infer<typeof sessionRestoredEventSchema>
1749  
1750  /**
1751   * Pre-1-2 persisted layout shape (flat slot/agent array). Parsed only by the
1752   * storage lazy legacy-conversion read path; never crosses IPC.
1753   */
1754  export const legacyPaneSchema = z.object({
1755    slot: z.number().int().min(0),
1756    agent: agentKindSchema
1757  })
1758  export type LegacyPane = z.infer<typeof legacyPaneSchema>
1759  export const legacyFlatLayoutSchema = z.array(legacyPaneSchema)
1760  
1761  
1762  /* ------------------------------------------------------------------ */
1763  /* Task 3b-3: the council run                                          */
1764  /* ------------------------------------------------------------------ */
1765  
1766  /**
1767   * ⚠ THE PATH IS AUTHORITATIVE AND `brief_text` IS GONE — Task 3b-4 REPLACED it,
1768   * it did not widen around it (D68(4)).
1769   *
1770   * 3b-3 shipped both: a `brief_path` LABEL main never opened, beside the
1771   * `brief_text` that was the real input. Keeping the text alongside the path
1772   * would leave two sources of truth for what the council deliberated on, and the
1773   * one the renderer controls would be the one that counts — which would make the
1774   * path validation in `councilService.validateBriefPath` decorative. Main opens
1775   * the path itself, and there is nothing else on this request for it to read.
1776   *
1777   * Nothing here can carry key material in either direction: a run names no
1778   * credential at all, because a member already names its own.
1779   */
1780  export const councilStartRequestSchema = z
1781    .object({
1782      project_id: z.uuid().nullable(),
1783      /** ⚠ VALIDATED IN MAIN, NEVER TRUSTED HERE. `min(1).max(1024)` is a bound on
1784       *  the string, not a security check — absolute, local, `.md`, existing, a
1785       *  regular file and under the size cap are all decided in main, because a
1786       *  renderer-supplied path main opens is an arbitrary-file-read primitive. */
1787      brief_path: z.string().min(1).max(1024)
1788    })
1789    .strict()
1790  export type CouncilStartRequest = z.infer<typeof councilStartRequestSchema>
1791  
1792  /* --- The brief picker: the `project:add` precedent, exactly ---------- */
1793  
1794  export const councilPickBriefRequestSchema = z.object({}).strict()
1795  export type CouncilPickBriefRequest = z.infer<typeof councilPickBriefRequestSchema>
1796  
1797  /** Cancel is a STRUCTURED NO-OP, not an error — the `project:add` shape. The
1798   *  path that comes back is still re-validated by `council:start`: the dialog is
1799   *  a convenience, never the boundary. */
1800  export const councilPickBriefResponseSchema = z.union([
1801    z.object({ path: z.string().min(1).max(1024) }).strict(),
1802    z.object({ cancelled: z.literal(true) }).strict()
1803  ])
1804  export type CouncilPickBriefResponse = z.infer<typeof councilPickBriefResponseSchema>
1805  
1806  /**
1807   * ⚠ D55, ENFORCED BY THE SCHEMA RATHER THAN BY DISCIPLINE. `cost_usd` cannot be
1808   * read without the counts it is a cost OF: how many members were planned, how
1809   * many answered, how many refused, and for how many the provider actually
1810   * reported usage. A response carrying a total alone does not parse.
1811   *
1812   * Every token field is nullable for the reason `TokenUsage`'s are: "not
1813   * reported" and "zero" are different facts, and a zero that means the first is
1814   * the confident-looking number D55 exists to forbid.
1815   */
1816  export const councilAccountingSchema = z
1817    .object({
1818      membersPlanned: z.number().int().nonnegative(),
1819      membersAnswered: z.number().int().nonnegative(),
1820      membersRefused: z.number().int().nonnegative(),
1821      /** ⚠ TURNS, not members — a four-member council runs eight turns across its
1822       *  four phases, and reporting the second as the first is a denominator
1823       *  nobody can read. Both ship, separately named. */
1824      turnsAnswered: z.number().int().nonnegative(),
1825      turnsRefused: z.number().int().nonnegative(),
1826      usageReported: z.number().int().nonnegative(),
1827      usageAbsent: z.number().int().nonnegative(),
1828      tokensIn: z.number().nullable(),
1829      tokensOut: z.number().nullable(),
1830      tokensCached: z.number().nullable()
1831    })
1832    .strict()
1833  export type CouncilAccounting = z.infer<typeof councilAccountingSchema>
1834  
1835  export const councilStartResponseSchema = z.union([
1836    z
1837      .object({
1838        ok: z.literal(true),
1839        run_id: z.uuid(),
1840        /** The findings TEXT, so the view can render it without reading a file. */
1841        findings: z.string(),
1842        /** ⚠ DERIVED IN MAIN FROM THE BRIEF PATH, never supplied by the renderer.
1843         *  NULL when the write failed — never a path that does not exist. */
1844        findings_path: z.string().nullable(),
1845        /** The reason beside the null, so an absent file is never an absent
1846         *  explanation. NULL when the file was written. */
1847        findings_error: z.string().nullable(),
1848        /** ⚠ REQUIRED, so the number below can never travel alone. */
1849        accounting: councilAccountingSchema,
1850        /** From the minted key's own usage figure — the provider computes it, so
1851         *  there is one number and one authority. NULL when it could not be read,
1852         *  never 0. */
1853        cost_usd: z.number().nullable()
1854      })
1855      .strict(),
1856    z.object({ ok: z.literal(false), reason: z.string() }).strict()
1857  ])
1858  export type CouncilStartResponse = z.infer<typeof councilStartResponseSchema>
1859  
1860  export const councilCancelRequestSchema = z.object({ run_id: z.uuid() }).strict()
1861  export type CouncilCancelRequest = z.infer<typeof councilCancelRequestSchema>
1862  
1863  /** `cancelled: false` means there was no such live run — a race the user cannot
1864   *  see, and not an error. */
1865  export const councilCancelResponseSchema = z.object({ cancelled: z.boolean() }).strict()
1866  export type CouncilCancelResponse = z.infer<typeof councilCancelResponseSchema>
1867  
1868  /** The broadcast, following `session:data` exactly. `delta` is SCRUBBED text
1869   *  from `SessionOutput`'s `onText`. */
1870  export const councilProgressEventSchema = z
1871    .object({
1872      runId: z.uuid(),
1873      phase: z.enum(['positions', 'critique', 'arbitration', 'synthesis', 'done']),
1874      round: z.number().int().nonnegative(),
1875      memberId: z.string().nullable(),
1876      delta: z.string()
1877    })
1878    .strict()
1879  export type CouncilProgressEvent = z.infer<typeof councilProgressEventSchema>
1880  
1881  /* ---- council:transcript — the read path D97 opened (Task 3e-4) ---------- */
1882  
1883  export const councilTranscriptRequestSchema = z.object({ run_id: z.uuid() }).strict()
1884  export type CouncilTranscriptRequest = z.infer<typeof councilTranscriptRequestSchema>
1885  
1886  /**
1887   * One stored turn, in the order `getCouncilMessagesForRun` returns.
1888   *
1889   * ⚠ `phase` IS A STRING AND NOT `councilProgressEventSchema`'s ENUM, ON PURPOSE.
1890   * These rows are HISTORY — written by whatever build was running at the time —
1891   * and a strict enum here would let one unrecognised stored value make an entire
1892   * paid run unreadable. The renderer already falls back to the raw string when it
1893   * has no label for a phase. Same reasoning as F4 for `member_id`: a transcript
1894   * legitimately names a member that has since been deleted (D62), so it is a
1895   * string rather than a `uuid()` FK-shaped claim.
1896   */
1897  export const councilTranscriptTurnSchema = z
1898    .object({
1899      member_id: z.string().nullable(),
1900      phase: z.string().min(1),
1901      round: z.number().int().nonnegative(),
1902      text: z.string()
1903    })
1904    .strict()
1905  export type CouncilTranscriptTurn = z.infer<typeof councilTranscriptTurnSchema>
1906  
1907  /**
1908   * ⚠ BOUNDED AT THE BOUNDARY, AND THE PAYLOAD ADMITS IT WHEN IT BIT.
1909   * ImplementationSpec-3e-4 §1: an arbitrarily large payload crossing the bridge
1910   * is not a thing to discover in production. The largest transcript on this
1911   * machine measures **112,531 characters over 8 turns** (run `c06874ad`, a full
1912   * four-member council); the cap is stated in `main/ipc.ts` beside the handler as
1913   * a multiple of that.
1914   *
1915   * ⚠ THE UNIT IS CHARACTERS, AND IT IS NAMED THAT WAY BECAUSE F39's RETRACTION
1916   * COST A RUN TO LEARN THE LESSON. `content` is a JS string; its `.length` is
1917   * UTF-16 code units, not bytes. Calling that "bytes" would be exactly the
1918   * mistake the 3e-1 measurement made when it compared SSE frame bytes across
1919   * models as though they were words.
1920   *
1921   * `total_turns` is `turns.length`'s DENOMINATOR (D55) — the count of rows
1922   * stored, whether or not they all fit — so a truncated read can never be
1923   * mistaken for a short deliberation.
1924   */
1925  export const councilTranscriptResponseSchema = z
1926    .object({
1927      run_id: z.uuid(),
1928      turns: z.array(councilTranscriptTurnSchema),
1929      /** Rows stored for this run. `turns.length` may be smaller; it is never
1930       *  larger. Zero means the run stored no transcript, which is itself a fact
1931       *  worth rendering rather than an error. */
1932      total_turns: z.number().int().nonnegative(),
1933      /** True when `turns` does not carry the whole transcript — because turns
1934       *  were dropped, or the last one's text was cut at the cap. */
1935      truncated: z.boolean(),
1936      /** Characters actually returned, and the cap in force. Emitted together so
1937       *  the figure stays readable after the constant moves. */
1938      chars: z.number().int().nonnegative(),
1939      cap_chars: z.number().int().positive()
1940    })
1941    .strict()
1942  export type CouncilTranscriptResponse = z.infer<typeof councilTranscriptResponseSchema>
1943  
1944  /**
1945   * Task 3c-2 / D74: the ONE payload shape the window channels carry.
1946   *
1947   * It does double duty on purpose, because it describes one fact: it is the
1948   * RESULT of `window:toggle-maximize` and the BODY of the
1949   * `window:maximized-changed` event. Two schemas for "is the window maximized"
1950   * could disagree, and the whole reason the event exists is that the renderer's
1951   * copy of this boolean is the one thing that goes stale.
1952   *
1953   * `window:minimize` and `window:close` take nothing and return nothing, so
1954   * they have no schema of their own — there is no payload to validate.
1955   *
1956   * `.strict()` for the F-5b reason the rest of this file documents: zod's
1957   * default STRIPS unknown keys, and a stripped field is an invisible one.
1958   */
1959  export const windowMaximizedSchema = z.object({ maximized: z.boolean() }).strict()
1960  export type WindowMaximized = z.infer<typeof windowMaximizedSchema>
1961  
```

### Exhibit 7 — `src/main/ipc.ts` (lines 1–2635, 128748 bytes)

```ts
   1  import { BrowserWindow, dialog, ipcMain } from 'electron'
   2  import { randomUUID } from 'crypto'
   3  import fs from 'node:fs'
   4  import path from 'node:path'
   5  import { logger, scrubSecrets } from './services/logger'
   6  import {
   7    LEGACY_CREDENTIALED_PROFILE_ID,
   8    resolveLaunchProfile,
   9    validateProfileShape
  10  } from './services/launchProfiles'
  11  import {
  12    resolveCouncilMember,
  13    resolveMemberModel,
  14    validateMemberShape
  15  } from './services/councilMembers'
  16  import {
  17    IpcChannel,
  18    layoutSetRequestSchema,
  19    attachRequestSchema,
  20    launchRequestSchema,
  21    launchResponseSchema,
  22    launchContextRequestSchema,
  23    launchContextResponseSchema,
  24    writeRequestSchema,
  25    resizeRequestSchema,
  26    killRequestSchema,
  27    sessionDataEventSchema,
  28    sessionExitEventSchema,
  29    sessionRestoredEventSchema,
  30    cliDetectRequestSchema,
  31    layoutGetRequestSchema,
  32    layoutGetResponseSchema,
  33    projectAddRequestSchema,
  34    projectAddResponseSchema,
  35    projectsListSchema,
  36    projectSelectRequestSchema,
  37    projectUpdateRequestSchema,
  38    projectUpdateResponseSchema,
  39    restartRequestSchema,
  40    restartResponseSchema,
  41    deleteSessionRequestSchema,
  42    setTitleRequestSchema,
  43    suggestMode,
  44    viewGetRequestSchema,
  45    viewSetRequestSchema,
  46    viewStateSchema,
  47    worktreeListRequestSchema,
  48    worktreeListResponseSchema,
  49    worktreeRemoveRequestSchema,
  50    worktreeRemoveResponseSchema,
  51    worktreeDirtyFilesRequestSchema,
  52    worktreeDirtyFilesResponseSchema,
  53    worktreeDiffRequestSchema,
  54    worktreeDiffResponseSchema,
  55    dirtyRemovalAllowed,
  56    branchForceAllowed,
  57    providerListRequestSchema,
  58    providerListResponseSchema,
  59    providerCreateRequestSchema,
  60    providerCreateResponseSchema,
  61    providerUpdateRequestSchema,
  62    providerUpdateResponseSchema,
  63    providerDeleteRequestSchema,
  64    providerDeleteResponseSchema,
  65    credentialListRequestSchema,
  66    credentialListResponseSchema,
  67    credentialCreateRequestSchema,
  68    credentialCreateResponseSchema,
  69    credentialReplaceRequestSchema,
  70    credentialReplaceResponseSchema,
  71    credentialDeleteRequestSchema,
  72    credentialDeleteResponseSchema,
  73    credentialTestRequestSchema,
  74    credentialTestResponseSchema,
  75    modelListRequestSchema,
  76    modelListResponseSchema,
  77    modelRefreshRequestSchema,
  78    modelRefreshResponseSchema,
  79    modelShortlistSetRequestSchema,
  80    modelShortlistSetResponseSchema,
  81    adapterListRequestSchema,
  82    adapterListResponseSchema,
  83    attentionReportSchema,
  84    attentionSummaryRequestSchema,
  85    attentionSummaryResponseSchema,
  86    attributionSummaryRequestSchema,
  87    attributionSummaryResponseSchema,
  88    MANAGEMENT_AUTH_MODE,
  89    type AdapterListResponse,
  90    type AttributionSummary,
  91    type AgentKind,
  92    type AttentionSummary,
  93    type AttachResponse,
  94    type CliDetectResponse,
  95    type CredentialCreateResponse,
  96    type CredentialDeleteResponse,
  97    type CredentialListResponse,
  98    type CredentialReplaceResponse,
  99    type CredentialTestResponse,
 100    type LaunchResponse,
 101    type LaunchContextResponse,
 102    type LayoutGetResponse,
 103    type ModelListResponse,
 104    type ModelRefreshResponse,
 105    type ModelShortlistSetResponse,
 106    agentKindSchema,
 107    launchProfileListResponseSchema,
 108    launchProfileCreateRequestSchema,
 109    launchProfileCreateResponseSchema,
 110    launchProfileUpdateRequestSchema,
 111    launchProfileUpdateResponseSchema,
 112    launchProfileDeleteRequestSchema,
 113    launchProfileDeleteResponseSchema,
 114    councilMemberListResponseSchema,
 115    councilMemberCreateRequestSchema,
 116    councilMemberCreateResponseSchema,
 117    councilMemberUpdateRequestSchema,
 118    councilMemberUpdateResponseSchema,
 119    councilMemberDeleteRequestSchema,
 120    councilMemberDeleteResponseSchema,
 121    type CouncilMemberListResponse,
 122    type CouncilMemberCreateResponse,
 123    type CouncilMemberUpdateResponse,
 124    type CouncilMemberDeleteResponse,
 125    type CouncilMemberWire,
 126    relaunchRequestSchema,
 127    relaunchResponseSchema,
 128    councilPickBriefRequestSchema,
 129    councilPickBriefResponseSchema,
 130    councilStartRequestSchema,
 131    councilStartResponseSchema,
 132    councilCancelRequestSchema,
 133    councilCancelResponseSchema,
 134    councilProgressEventSchema,
 135    councilTranscriptRequestSchema,
 136    councilTranscriptResponseSchema,
 137    windowMaximizedSchema,
 138    type CouncilPickBriefResponse,
 139    type CouncilStartResponse,
 140    type CouncilCancelResponse,
 141    type CouncilTranscriptResponse,
 142    type CouncilTranscriptTurn,
 143    type LaunchProfileListResponse,
 144    type LaunchProfileCreateResponse,
 145    type LaunchProfileUpdateResponse,
 146    type LaunchProfileDeleteResponse,
 147    type LaunchProfileWire,
 148    type RelaunchResponse,
 149    type EffortLevel,
 150    type PickableWorktree,
 151    type Project,
 152    type ProjectAddResponse,
 153    type ProjectsList,
 154    type ProjectUpdateResponse,
 155    type ProviderConfig,
 156    type ProviderCreateResponse,
 157    type ProviderDeleteResponse,
 158    type ProviderListResponse,
 159    type ProviderUpdateResponse,
 160    type RestartResponse,
 161    type ViewState,
 162    type WorktreeDiffSummary,
 163    type WorktreeRemoveResponse,
 164    type WorktreeSummary
 165  } from '../shared/ipc'
 166  import { collectSessionIds } from '../shared/layout'
 167  import { detectClis } from './services/cliDetect'
 168  import { getAdapter, staticRegistry } from './adapters/registry'
 169  // D84: the harness-less provider-type declaration. NOT in `staticRegistry` and
 170  // NOT an `AgentAdapter` — see src/main/adapters/noHarness.ts.
 171  import { NO_HARNESS_DESCRIPTOR, noHarnessAuthMethods } from './adapters/noHarness'
 172  import { resolveEnvVarName } from './adapters/env'
 173  import type { PtyLaunchRoute, ResolvedCredential } from './adapters/types'
 174  import { failureMessage, type ResolvedEnvelope } from './services/vaultCore'
 175  import { refreshProviderModels } from './services/modelCatalog'
 176  import { catalogFreshness, computeCatalogDiff } from './services/modelCatalogCore'
 177  // Task 3b-1: the api-mode transport, and the ONE ingest-scrub seam it is
 178  // driven through (D45(1)/D46). The factory holds no scrubber; this side does.
 179  import type { CredentialProfileRow } from './db/schema'
 180  import {
 181    resolveRepoRoot,
 182    currentBranch,
 183    aheadBehind,
 184    listWorktrees,
 185    diffShortstat,
 186    statusPorcelain
 187  } from './services/git'
 188  import type { AttentionTracker } from './services/attention'
 189  import type { DispatchAttribution, MintForDispatchResult } from './services/dispatchAttribution'
 190  import { createCouncilService, type CouncilService, type MemberRoute } from './services/councilService'
 191  import { OPENROUTER_GATEWAY_BASE_URL, type OpenRouterKeyClient } from './services/openrouterKeys'
 192  import type { LaunchOptions, SessionManager } from './services/sessionManager'
 193  import type { ProjectRecord, StorageService } from './services/storage'
 194  import type { CredentialVault } from './services/vault'
 195  import { worktreeRootFor, type GitWorktreeManager } from './services/worktrees'
 196  import type { CouncilMemberRow, LaunchProfileRow, NewProviderConfigRow, ProviderConfigRow, WorktreeRow } from './db/schema'
 197  
 198  /** Soft cap on panes per project (spec §6/§12): bounds how many agent
 199   *  processes one project can hold; launches beyond it are rejected. */
 200  const LAUNCH_PANE_CAP = 16
 201  
 202  /**
 203   * Ceiling on one `council:transcript` response (D97 / Task 3e-4).
 204   *
 205   * ⚠ A MEASURED MULTIPLE, NOT A ROUND NUMBER THAT LOOKS GENEROUS — 3e-2 has just
 206   * finished rewriting `RESPONSE_CAP_BYTES`'s comment for being the latter. The
 207   * largest transcript stored on this machine is **112,531 characters over 8
 208   * turns** (run `c06874ad`, a FULL four-member council; the partial run before it
 209   * stored 93,868 over 7). Per-turn mean 14,066, so a 13-turn run projects to
 210   * ~183,000. This is **~8.9× the largest measured and ~5.5× that projection**.
 211   *
 212   * ⚠ CHARACTERS, NOT BYTES, AND THE NAME SAYS SO. `content` is a JS string and
 213   * `.length` counts UTF-16 code units. F39's retraction is the standing lesson: a
 214   * figure whose unit is assumed rather than stated is how a measurement becomes
 215   * an argument.
 216   *
 217   * When a run exceeds it the response returns what fits and sets `truncated`.
 218   * Silence would be the real defect — a truncated transcript that does not admit
 219   * truncation is worse than no reader at all.
 220   */
 221  const COUNCIL_TRANSCRIPT_CAP_CHARS = 1_000_000
 222  
 223  /** Map the internal record onto the IPC wire shape (snake_case root_path). */
 224  function toWireProject(p: ProjectRecord): Project {
 225    return {
 226      id: p.id,
 227      name: p.name,
 228      root_path: p.rootPath,
 229      color: p.color,
 230      description: p.description
 231    }
 232  }
 233  
 234  /** Map a provider row onto the IPC wire shape (snake_case columns). Explicit
 235   *  construction, same discipline as toWireProject — a spread would silently
 236   *  re-admit any column a future migration adds. */
 237  function toWireProvider(row: ProviderConfigRow): ProviderConfig {
 238    return {
 239      id: row.id,
 240      name: row.name,
 241      adapter_type: row.adapterType,
 242      auth_mode: row.authMode,
 243      env_var_name: row.envVarName,
 244      base_url: row.baseUrl,
 245      extra_headers_json: row.extraHeadersJson,
 246      model: row.model,
 247      created_at: row.createdAt
 248    }
 249  }
 250  
 251  /** Task 3-2 / spec §6.4: the refusal shared by provider:create and
 252   *  provider:update when extra_headers_json carries a known key shape. */
 253  const PROVIDER_HEADERS_SECRET_REFUSAL =
 254    'Extra headers look like they contain a credential (a known key shape matched). ' +
 255    'Provider headers are stored in PLAINTEXT — put the credential on a credential profile instead, where it is encrypted.'
 256  
 257  /** spec §6.4: run incoming extra_headers_json through scrubSecrets; if the
 258   *  scrub would CHANGE the text, a known key shape is present. Turns the
 259   *  documented "provider headers are non-secret" assumption into an enforced
 260   *  one, using the canonical pattern list Task 3-1 shipped. */
 261  function headersContainSecret(extraHeadersJson: string | null | undefined): boolean {
 262    if (extraHeadersJson === undefined || extraHeadersJson === null) return false
 263    return scrubSecrets(extraHeadersJson) !== extraHeadersJson
 264  }
 265  
 266  /** Task 3a-5: the SAME test, for one env value. Injected into
 267   *  `validateProfileShape` so the pure core stays free of the logger — ONE
 268   *  pattern list, one home, the `extra_headers_json` precedent above. */
 269  function containsSecret(value: string): boolean {
 270    return scrubSecrets(value) !== value
 271  }
 272  
 273  /** Task 3a-5: `agentKindSchema`'s membership test, for a persisted free-text
 274   *  `sessions.agent`. D34(c): an unknown persisted agent is a REFUSAL, never a
 275   *  throw. */
 276  function isAgentKind(agent: string): agent is AgentKind {
 277    return agentKindSchema.safeParse(agent).success
 278  }
 279  
 280  /** Strip C0 control chars + DEL from a captured title; titles are raw terminal
 281   *  output. Returns the trimmed remainder (possibly empty — the caller rejects
 282   *  an empty result rather than writing a blank title). */
 283  export function sanitizeTitle(raw: string): string {
 284    // eslint-disable-next-line no-control-regex
 285    return raw.replace(/[\x00-\x1F\x7F]/g, '').trim()
 286  }
 287  
 288  /** The fixed, sanitized probe-failure vocabulary (spec §7.2). NOTHING from a
 289   *  response body or an exception ever reaches the renderer: status codes map
 290   *  to fixed strings, fetch exceptions collapse to one, and every outbound
 291   *  message passes through scrubSecrets as a final net. */
 292  function probeFailure(message: string): { ok: false; reason: string } {
 293    return { ok: false, reason: scrubSecrets(message) }
 294  }
 295  
 296  /** Task 3-6 test-key: ONE live call. No retry, no backoff, no cache, no
 297   *  catalog (D28). The endpoint and header shape are the OpenAI-compatible
 298   *  /chat/completions probe (D4: OpenRouter rejects bad keys with 401 and
 299   *  authenticates good ones before any model error — verified against
 300   *  OpenRouter's own API reference this session); `max_tokens: 1` bounds the
 301   *  cost of a successful probe. If the provider names a default model (D48)
 302   *  the probe uses it; otherwise OpenRouter's `openrouter/auto` meta-model —
 303   *  D42 made OpenRouter the single gateway. */
 304  async function probeCredential(
 305    envelope: ResolvedEnvelope,
 306    provider: ProviderConfigRow
 307  ): Promise<{ ok: true } | { ok: false; reason: string }> {
 308    const baseUrl = (envelope.baseUrl ?? provider.baseUrl)?.replace(/\/+$/, '')
 309    if (!baseUrl) {
 310      return probeFailure(`Provider '${provider.name}' has no base URL to probe.`)
 311    }
 312    // Provider-level headers are documented NON-SECRET (D33 resolution e);
 313    // the envelope's own extraHeaders override them. A hand-edited headers
 314    // column degrades to no extra headers rather than breaking the probe.
 315    let providerHeaders: Record<string, string> = {}
 316    try {
 317      const parsed: unknown = provider.extraHeadersJson ? JSON.parse(provider.extraHeadersJson) : {}
 318      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
 319        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
 320          if (typeof v === 'string') providerHeaders[k] = v
 321        }
 322      }
 323    } catch {
 324      providerHeaders = {}
 325    }
 326    try {
 327      const res = await fetch(`${baseUrl}/chat/completions`, {
 328        method: 'POST',
 329        headers: {
 330          'content-type': 'application/json',
 331          authorization: `Bearer ${envelope.key}`,
 332          ...providerHeaders,
 333          ...(envelope.extraHeaders ?? {})
 334        },
 335        body: JSON.stringify({
 336          model: provider.model ?? 'openrouter/auto',
 337          messages: [{ role: 'user', content: 'ping' }],
 338          max_tokens: 1
 339        }),
 340        signal: AbortSignal.timeout(10_000)
 341      })
 342      // The body is NEVER read into a message — a 401 body can echo the
 343      // submitted key (leakage path 1). Cancel and discard it.
 344      void res.body?.cancel().catch(() => undefined)
 345      if (res.status >= 200 && res.status < 300) return { ok: true }
 346      if (res.status === 401 || res.status === 403) {
 347        return probeFailure('Authentication failed — the credential was rejected.')
 348      }
 349      if (res.status === 429) return probeFailure('Rate limited by the provider.')
 350      if (res.status >= 500) return probeFailure('The provider returned an error.')
 351      return probeFailure(`Unexpected response (${res.status}).`)
 352    } catch {
 353      // Leakage path 2: a fetch exception's cause chain can carry the request,
 354      // headers included. Discard it wholesale.
 355      return probeFailure('Could not reach the provider.')
 356    }
 357  }
 358  
 359  /**
 360   * Register all IPC handlers. Every renderer payload is Zod-parsed before use;
 361   * a payload that fails validation rejects the invoke and never reaches the PTY.
 362   *
 363   * Task 1-5: no closure over a single project — every project-scoped handler
 364   * resolves `project_id` from its parsed request and FK-checks it against the
 365   * projects table (schema validity ≠ existence) before touching anything.
 366   *
 367   * Task 2-2: the GitWorktreeManager is threaded in from index.ts (the single
 368   * instance constructed for the boot reconcile) — session:launch's new-worktree
 369   * path is its first caller.
 370   *
 371   * Task 3-2: the CredentialVault is threaded in the same way (D33). The
 372   * credential:* handlers are WRITE-ONLY inbound — the plaintext key arrives on
 373   * credential:create / credential:replace and no response ever carries key
 374   * material or a fingerprint; the outbound .parse on every provider and
 375   * credential handler is what makes that structural rather than aspirational.
 376   */
 377  export function registerIpc(
 378    sessions: SessionManager,
 379    storage: StorageService,
 380    worktrees: GitWorktreeManager,
 381    vault: CredentialVault,
 382    // 3a-2: a fifth positional parameter, exactly as `vault` was added in 3-2.
 383    attention: AttentionTracker,
 384    // 3a-3: the sixth, on the same precedent (vault -> 3-2, attention -> 3a-2).
 385    attribution: DispatchAttribution,
 386    /**
 387     * 3b-3: the seventh, on the same precedent again — and it is THE SAME
 388     * INSTANCE `DispatchAttribution` holds, threaded from `index.ts` rather than
 389     * constructed here. A council run mints its own key, and building a second
 390     * client to do it would create a second management-key path beside the one
 391     * whose decrypt-per-use discipline was designed in 3a-3.
 392     */
 393    keys: OpenRouterKeyClient,
 394    /** The eighth, from the SAME `managementProfileId()` thunk `DispatchAttribution`
 395     *  already uses — one home for "is there a management key", not a second
 396     *  query that can disagree with the first. */
 397    hasManagementKey: () => boolean
 398  ): CouncilService {
 399    function requireProject(projectId: string): ProjectRecord {
 400      const p = storage.getProjectById(projectId)
 401      if (!p) throw new Error(`Unknown project_id: ${projectId}`)
 402      return p
 403    }
 404  
 405    /**
 406     * Resolve + decrypt a credential profile for one launch (Task 3-6, D33
 407     * clause 4 + action 6). The plaintext exists in this function's scope and
 408     * in the returned object, and nowhere else in main — it is not cached, not
 409     * memoized, not attached to any long-lived object, and never passed to
 410     * anything that logs its arguments.
 411     *
 412     * Returns a discriminated result rather than throwing, because every
 413     * failure here is a CONTRACT path (clause 8) that must surface as an
 414     * inline refusal — and the refusal happens BEFORE any session row exists.
 415     *
 416     * ⚠ D84 (Task 3d-1): `harness` IS NULLABLE, AND NULL IS NOT "UNKNOWN" — it is
 417     * the caller stating that IT IS NOT AN AGENT CLI. Only the council passes it
 418     * (see `resolveMemberRoute`), and it replaces the manufactured `AgentKind`
 419     * that used to be parsed out of the provider's own `adapter_type` purely to
 420     * satisfy this parameter. That manufacture was Blocker A: it REFUSED any
 421     * provider that named no agent, in order to feed an ownership check the
 422     * comment at the call site already described as "a no-op HERE" — the check
 423     * compared `provider.adapterType` against a value derived FROM
 424     * `provider.adapterType`, so it could never fail and never protected
 425     * anything, while the parse in front of it rejected exactly the providers
 426     * this task exists to admit.
 427     *
 428     * ⚠ EVERY OTHER REFUSAL BELOW STAYS IN FORCE FOR BOTH KINDS OF CALLER, and
 429     * the ownership check itself (Blocker B) is UNCHANGED for every caller that
 430     * names a harness — all three launch call sites pass a real `AgentKind`.
 431     */
 432    async function resolveCredential(
 433      profileId: string,
 434      harness: AgentKind | null
 435    ): Promise<
 436      | {
 437          ok: true
 438          credential: ResolvedCredential
 439          route: PtyLaunchRoute | null
 440          /** 3a-3 (D42): the attribution discriminator, resolved HERE because
 441           *  this is the one place that has both the provider row and the
 442           *  adapter's declarations. `null` when the provider's auth_mode matches
 443           *  no AuthMethodDefinition the adapter declares — in which case nothing
 444           *  is minted, because a strategy cannot be chosen from a mode we cannot
 445           *  identify. */
 446          authType: 'subscription' | 'api_key' | null
 447        }
 448      | { ok: false; reason: string }
 449    > {
 450      // 1. Load the profile row.
 451      const profile = storage.getCredentialProfileById(profileId)
 452      if (!profile) return { ok: false, reason: 'That credential profile no longer exists.' }
 453      // 2. Already known-bad: refuse WITHOUT re-attempting decryption — the row
 454      //    is marked, and a retry only widens the window (D33 clause 8).
 455      if (profile.unavailableSince) {
 456        return { ok: false, reason: failureMessage('undecryptable', profile.label) }
 457      }
 458      // 3. Load the provider; it must belong to THIS agent (the dialog filters,
 459      //    but main never trusts the renderer) and resolve the env var name —
 460      //    provider override beats the adapter's api_key default (D34(e)).
 461      const provider = storage.getProviderConfigById(profile.providerId)
 462      if (!provider) {
 463        return { ok: false, reason: `The provider for credential profile '${profile.label}' no longer exists.` }
 464      }
 465      // ⚠ BLOCKER B, AND IT IS DELIBERATELY NOT WEAKENED (D84). The guard is
 466      // GATED, not relaxed: a caller that names a harness gets the identical
 467      // comparison it has always got, and a credential for a Claude provider
 468      // still cannot launch under codex. `harness === null` skips it because a
 469      // caller with no CLI has nothing to own the credential — which is what the
 470      // council was already asserting, badly, by passing the provider's own
 471      // column back in.
 472      if (harness !== null && provider.adapterType !== harness) {
 473        return {
 474          ok: false,
 475          reason: `Credential profile '${profile.label}' belongs to provider '${provider.name}', which is not a ${harness} provider.`
 476        }
 477      }
 478      // 3a-3 / D42 operational note: the OpenRouter MANAGEMENT key is a distinct,
 479      // higher-privilege credential class — it mints and revokes keys and cannot
 480      // do inference. It must never reach a child PTY.
 481      //
 482      // ⚠ THIS REFUSAL SITS BEFORE `vault.decryptForLaunch`, DELIBERATELY, so a
 483      // management profile is not even DECRYPTED on a launch path — the plaintext
 484      // never exists in this function's scope at all. OpenRouter enforces the
 485      // same rule server-side, but a guarantee that depends on a third party is
 486      // not a guarantee.
 487      //
 488      // LaunchDialog.vue already filters `auth_mode === 'api_key'`, so this is
 489      // not reachable through the UI — and that is exactly why it is here: main
 490      // never trusts the renderer, and a filter in a dialog is not an invariant.
 491      if (provider.authMode === MANAGEMENT_AUTH_MODE) {
 492        // Label only (D33 clause 8) — never the provider name's secrets, never a
 493        // hint about the key.
 494        return {
 495          ok: false,
 496          reason: `Credential profile '${profile.label}' is an OpenRouter management key and cannot be used to launch an agent.`
 497        }
 498      }
 499      // D84: the declarations to resolve against. With a harness that is the
 500      // adapter's own; with none it is `noHarnessAuthMethods()` — the SAME
 501      // declaration `adapter:list` publishes to the provider form, so what the
 502      // user was offered and what main resolves cannot disagree. There is no
 503      // third branch and no inline literal here.
 504      const authMethods =
 505        harness !== null ? staticRegistry[harness].getAuthMethods() : noHarnessAuthMethods()
 506      // The discriminator, resolved from the adapter's OWN declarations rather
 507      // than from the provider row's free-text column.
 508      const authType = authMethods.find((m) => m.type === provider.authMode)?.type ?? null
 509      const apiKeyMethod = authMethods.find((m) => m.type === 'api_key') ?? null
 510      const envVarName = resolveEnvVarName(provider.envVarName, apiKeyMethod?.requiredEnvVar ?? null)
 511      if (envVarName === null) {
 512        return {
 513          ok: false,
 514          reason: `Provider '${provider.name}' has no API-key environment variable configured.`
 515        }
 516      }
 517      // 4. Decrypt. On failure the vault has already marked unavailable_since;
 518      //    its message is label-only by construction (D33 clause 8).
 519      const dec = await vault.decryptForLaunch(profileId)
 520      if (!dec.ok) return { ok: false, reason: dec.message }
 521      // 5. The envelope -> credential join (3-2 finding F-3): value + resolved
 522      //    name + isSecret. extraHeaders has NO PTY env mapping (api-mode
 523      //    concern, Phase 3b) — it launches fine and is simply unused here.
 524      //    baseUrl (envelope overrides provider, D33(e)) becomes the ROUTE's
 525      //    endpoint metadata — non-secret argv material for codex's -c
 526      //    overrides, never an env var guess (ANTHROPIC_BASE_URL is not
 527      //    D4-verifiable from `claude --help`, so the base-URL env mapping is
 528      //    deliberately deferred).
 529      const credential: ResolvedCredential = { envVarName, value: dec.value.key, isSecret: true }
 530      const baseUrl = dec.value.baseUrl ?? provider.baseUrl
 531      const route: PtyLaunchRoute | null = baseUrl
 532        ? { providerKey: 'chorus', providerName: provider.name, baseUrl, modelId: provider.model }
 533        : null
 534      return { ok: true, credential, route, authType }
 535    }
 536  
 537    /**
 538     * Task 3a-5: one launch-profile row -> its wire shape.
 539     *
 540     * The RESOLVED model (rank 1 -> rank 2 -> null) and `disabled_reason` are
 541     * both computed HERE, in main, so the renderer never re-implements 3a-4's
 542     * precedence table and never decides eligibility for itself.
 543     *
 544     * ⚠ An unlaunchable profile gets a `disabled_reason`, NOT omission. The
 545     * picker shows it, disables it, and renders the reason: a launch profile is a
 546     * row the USER NAMED, and a named entry that silently vanishes is worse than
 547     * one that says why it cannot launch.
 548     *
 549     * Every free-text field on the way out is scrubbed — labels and provider
 550     * names are user-authored, so a user who pasted a key into one must not have
 551     * it echoed back into the DOM.
 552     */
 553    function toWire(row: LaunchProfileRow): LaunchProfileWire {
 554      const provider = row.providerId ? storage.getProviderConfigById(row.providerId) : null
 555      const credential = row.credentialProfileId
 556        ? storage.getCredentialProfileById(row.credentialProfileId)
 557        : null
 558      const resolution = resolveLaunchProfile(row, provider, credential)
 559      return {
 560        id: row.id,
 561        label: scrubSecrets(row.label),
 562        agent: row.agent as AgentKind,
 563        provider_id: row.providerId,
 564        provider_name: provider ? scrubSecrets(provider.name) : null,
 565        credential_profile_id: row.credentialProfileId,
 566        credential_label: credential ? scrubSecrets(credential.label) : null,
 567        model: resolution.ok ? resolution.plan.model : (row.model ?? provider?.model ?? null),
 568        effort: resolution.ok ? resolution.plan.effort : null,
 569        permission_mode: row.permissionMode,
 570        workspace_mode: row.workspaceMode === 'new-worktree' ? 'new-worktree' : 'current-tree',
 571        env_json: row.envJson,
 572        disabled_reason: resolution.ok ? null : scrubSecrets(resolution.reason),
 573        created_at: row.createdAt,
 574        updated_at: row.updatedAt
 575      }
 576    }
 577  
 578    /** Ordered by label in MAIN — the renderer sorts nothing. */
 579    function listLaunchProfileWire(): LaunchProfileWire[] {
 580      return storage
 581        .listLaunchProfiles()
 582        .map(toWire)
 583        .sort((a, b) => a.label.localeCompare(b.label))
 584    }
 585  
 586    /**
 587     * Task 3b-2 / D62: a council member row -> the wire shape.
 588     *
 589     * ⚠ THE ROUTE IS RESOLVED THROUGH THE CREDENTIAL, and there is no other way
 590     * to reach it — the row carries no `provider_id` and no `base_url` (D48's
 591     * one-home rule). What comes back out is a NAME, never an endpoint.
 592     *
 593     * ⚠ `model` AND `resolvedModel` ARE BOTH ON THE WIRE, AND THAT IS THE PROOF
 594     * D56 ASKS FOR. `model` is the raw column — NULL means this member inherits;
 595     * `resolvedModel` is rank 1 > rank 2 > null, computed here and NEVER written
 596     * back. Collapsing them into one field is how a "helpful" back-write into
 597     * rank 1 gets written by someone reading the UI.
 598     *
 599     * An unresolvable member is SHOWN, DISABLED AND EXPLAINED — never filtered
 600     * out. A council member is a row the USER NAMED, and a named entry that
 601     * silently vanishes is worse than one that says why it cannot deliberate.
 602     *
 603     * Every free-text field on the way out is scrubbed — labels and route names
 604     * are user-authored, so a user who pasted a key into one must not have it
 605     * echoed back into the DOM. `params_json` is deliberately NOT on the wire at
 606     * all: it is the field most able to carry a pasted value, it is refused at
 607     * write if it matches a known key shape, and it never round-trips.
 608     */
 609    function toCouncilMemberWire(row: CouncilMemberRow): CouncilMemberWire {
 610      // ONE lookup path, shared with the create/update handlers: through the
 611      // credential, because that is the only pointer the row has.
 612      const { credential, provider } = councilRouteFor(row.credentialProfileId)
 613      const resolution = resolveCouncilMember(row, provider, credential)
 614      return {
 615        id: row.id,
 616        label: scrubSecrets(row.label),
 617        credentialProfileId: row.credentialProfileId,
 618        credentialLabel: credential ? scrubSecrets(credential.label) : null,
 619        providerName: provider ? scrubSecrets(provider.name) : null,
 620        // THE RAW COLUMN. Untouched by resolution — the proof is a column.
 621        model: row.model,
 622        // D56, resolved. A refused member still reports what it WOULD resolve to,
 623        // so the list can explain the row rather than blanking it.
 624        resolvedModel: resolveMemberModel(row, provider),
 625        // ⚠ The wire vocabulary is CLOSED (councilRoleSchema), so a hand-edited
 626        // `role` has nowhere legal to go. It is NOT silently accepted: the same
 627        // row comes back `available: false` with `unavailableReason` naming the
 628        // unrecognised role, because `resolveCouncilMember` refuses it. Falling
 629        // back here rather than throwing is the defensive-READ discipline — the
 630        // list is what lets a user FIX such a row, so a bad row must never be
 631        // able to break it (the `getWindowBounds` / `readAttentionSpans` rule).
 632        role: row.role === 'arbiter' ? 'arbiter' : 'member',
 633        available: resolution.ok,
 634        unavailableReason: resolution.ok ? null : scrubSecrets(resolution.reason)
 635      }
 636    }
 637  
 638    /** Ordered by label in MAIN — the renderer sorts nothing. */
 639    function listCouncilMemberWire(): CouncilMemberWire[] {
 640      return storage
 641        .listCouncilMembers()
 642        .map(toCouncilMemberWire)
 643        .sort((a, b) => a.label.localeCompare(b.label))
 644    }
 645  
 646    /** The two row views the pure core wants, read through the credential. A
 647     *  member has no provider pointer of its own — that is the ruling, restated
 648     *  as the only lookup path there is. */
 649    function councilRouteFor(credentialProfileId: string): {
 650      credential: {
 651        id: string
 652        providerId: string
 653        label: string
 654        unavailableSince: string | null
 655      } | null
 656      provider: { id: string; name: string; authMode: string; model: string | null } | null
 657    } {
 658      const credential = storage.getCredentialProfileById(credentialProfileId)
 659      if (!credential) return { credential: null, provider: null }
 660      const provider = storage.getProviderConfigById(credential.providerId)
 661      return {
 662        credential: {
 663          id: credential.id,
 664          providerId: credential.providerId,
 665          label: credential.label,
 666          unavailableSince: credential.unavailableSince
 667        },
 668        provider: provider
 669          ? { id: provider.id, name: provider.name, authMode: provider.authMode, model: provider.model }
 670          : null
 671      }
 672    }
 673  
 674    /** F17: git reports forward-slash paths and Windows is case-insensitive —
 675     *  every path comparison goes through this key (worktrees.ts's pathKey is
 676     *  the reference; duplicated here because main/ipc may not reach into that
 677     *  module's private helper). */
 678    function pathKey(p: string): string {
 679      return path.win32.normalize(p).toLowerCase()
 680    }
 681  
 682    /** F18 resolution (a) — decided at 2-2 execution: the branch label resolves
 683     *  from the WORKTREES side (worktrees.session_id, the authoritative pointer
 684     *  per D26(a)), never from sessions.worktree_id. The crash window between
 685     *  `git worktree add` and activation leaves sessions.worktree_id NULL while
 686     *  the row side is already set, and re-owning a worktree leaves the previous
 687     *  owner's sessions.worktree_id stale — row-side resolution renders the
 688     *  correct label in both cases. Task 2-4's diff summary MUST resolve the
 689     *  worktree the identical way. */
 690    function worktreeForSession(sessionId: string, projectId: string): WorktreeRow | null {
 691      return storage.getWorktreesForProject(projectId).find((w) => w.sessionId === sessionId) ?? null
 692    }
 693  
 694    function branchForSession(sessionId: string, projectId: string): string | null {
 695      return worktreeForSession(sessionId, projectId)?.branch ?? null
 696    }
 697  
 698    ipcMain.handle(IpcChannel.SessionAttach, (_event, payload): AttachResponse => {
 699      const { sessionId } = attachRequestSchema.parse(payload)
 700      // The sessionId is a sessions DB row id; the row supplies the persisted
 701      // exit state and cwd for the manager-unknown path below.
 702      const row = storage.getSessionById(sessionId)
 703      if (!row) throw new Error(`Unknown sessionId: ${sessionId}`)
 704      // 2-2: the branch label resolves row-side (F18a) — see worktreeForSession.
 705      // 2-3: the owning worktree row's id rides along for the close flow.
 706      const wt = worktreeForSession(row.id, row.projectId)
 707      const branch = wt?.branch ?? null
 708      const worktreeId = wt?.id ?? null
 709      const snap = sessions.attach(sessionId)
 710      if (snap) {
 711        // Live in the manager. The restored flag lets a pane that mounted after
 712        // the session:restored event still wear the badge — consumed here, so
 713        // exactly one attach reports it per restore relaunch. The snapshot has
 714        // no title of its own; the row is the source (1b-1).
 715        return sessions.consumeRestoredBadge(sessionId)
 716          ? { ...snap, title: row.title, branch, worktreeId, restored: true }
 717          : { ...snap, title: row.title, branch, worktreeId }
 718      }
 719      // Unknown to the SessionManager (row from a previous app run, or a session
 720      // the restore engine has not reached yet): attach never spawns — report
 721      // the row's persisted exit state plus the restore chrome signals.
 722      return {
 723        sessionId: row.id,
 724        buffer: '',
 725        status: 'exited',
 726        exitCode: row.exitCode,
 727        title: row.title,
 728        branch,
 729        worktreeId,
 730        ...(sessions.isRestorePending(sessionId) ? { restorePending: true } : {}),
 731        ...(!fs.existsSync(row.cwd) ? { cwdMissing: true } : {})
 732      }
 733    })
 734  
 735    ipcMain.handle(IpcChannel.SessionLaunch, async (_event, payload): Promise<LaunchResponse> => {
 736      const req = launchRequestSchema.parse(payload)
 737      const p = requireProject(req.project_id)
 738      // Security boundary: cwd must be absolute and exist. Main-only, before
 739      // any row is created or PTY spawned; the renderer is never trusted.
 740      if (!path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd)) {
 741        return { ok: false, reason: `Directory not found or not absolute: ${req.cwd}` }
 742      }
 743      // Soft pane cap (spec §6): a pathological layout cannot fork dozens of
 744      // agent processes. Panes = layout leaves for this project. Applies to
 745      // every mode — a worktree launch adds a pane too.
 746      const layout = storage.getPaneLayout(p.id)
 747      const paneCount = layout ? collectSessionIds(layout.root).length : 0
 748      if (paneCount >= LAUNCH_PANE_CAP) {
 749        return { ok: false, reason: `Pane cap reached (${LAUNCH_PANE_CAP} per project)` }
 750      }
 751  
 752      // Task 3-6 (D33 clauses 4/8): resolve + decrypt the credential BEFORE any
 753      // session row is created — a refusal here leaves no orphan row, and there
 754      // is NO ambient-credential fallback: a launch naming a profile either gets
 755      // its key or does not happen. The plaintext's lifetime is: this variable
 756      // -> buildLaunch's secretEnv -> the child env block + the scrubber match
 757      // set (the D33(a) sanctioned retention). Nowhere else.
 758      // Task 3a-4: the app-level effort level, threaded from the parsed request
 759      // alongside secrets/credential/route. Absent when the dialog offered no
 760      // control (a null descriptor) or the user chose nothing — and absent means
 761      // NO effort argument is emitted, which is what keeps a no-effort launch
 762      // byte-identical to a pre-3a-4 one. Nothing persists it: it is per-launch
 763      // until 3a-5's launch_profiles exists.
 764      // Task 3a-5 / D43. The division of authority, stated once so it is not
 765      // re-invented at the call site:
 766      //   PROFILE -> credential, route, model, effort, permission mode, env
 767      //   PAYLOAD -> agent, cwd, workspace_mode  (the user may change all three
 768      //              after picking a profile, and cwd is the SECURITY BOUNDARY
 769      //              main validates ITSELF above — a stored row is untrusted
 770      //              input like any other, so a profile supplies no cwd at all).
 771      if (req.launch_profile_id && req.credential_profile_id) {
 772        return { ok: false, reason: 'Pick a launch profile or a credential, not both.' }
 773      }
 774      let launchProfileId: string | null = null
 775      // The credential this launch will resolve: from the profile when one was
 776      // named, else from the payload. ONE resolver either way.
 777      let credentialProfileId: string | null = req.credential_profile_id ?? null
 778      let profileEffort: EffortLevel | null = null
 779      let profileEnv: Readonly<Record<string, string>> = {}
 780      /**
 781       * D90: rank 1 of D56's order — the saved profile's model.
 782       *
 783       * ⚠ THIS CAPTURE FIXES A LATENT GAP RATHER THAN ADDING A FEATURE.
 784       * `resolveLaunchProfile` has computed `plan.model` (rank 1 -> rank 2) since
 785       * 3a-5, and `toWire` DISPLAYS it in the profile chip — but no launch path
 786       * ever read it, so the route always carried `provider_configs.model` and a
 787       * profile's own model silently did nothing. It surfaces now because D90
 788       * adds rank 0 directly above it, and a live rank 0 sitting on top of a dead
 789       * rank 1 would be worse than either.
 790       */
 791      let profileModel: string | null = null
 792      if (req.launch_profile_id) {
 793        const profile = storage.getLaunchProfileById(req.launch_profile_id)
 794        if (!profile) return { ok: false, reason: 'That launch profile no longer exists.' }
 795        // Main never trusts the renderer: a mismatched pair is a renderer bug,
 796        // not a user intent.
 797        if (profile.agent !== req.agent) {
 798          return { ok: false, reason: `That launch profile is for ${profile.agent}, not ${req.agent}.` }
 799        }
 800        const resolution = resolveLaunchProfile(
 801          profile,
 802          profile.providerId ? storage.getProviderConfigById(profile.providerId) : null,
 803          profile.credentialProfileId
 804            ? storage.getCredentialProfileById(profile.credentialProfileId)
 805            : null
 806        )
 807        if (!resolution.ok) return { ok: false, reason: resolution.reason }
 808        launchProfileId = profile.id
 809        credentialProfileId = resolution.plan.credentialProfileId
 810        profileEffort = resolution.plan.effort
 811        profileEnv = resolution.plan.envAdditions
 812        profileModel = resolution.plan.model
 813      }
 814      // ⚠ THE PAYLOAD WINS over the profile's stored effort, because the payload
 815      // is what the user is looking at in the dialog; the profile is the DEFAULT
 816      // the dialog prefilled. 3a-4's precedence order is otherwise unchanged and
 817      // unextended — a profile supplies a rank-2 value and does not create a
 818      // rank 0.
 819      const effortValue: EffortLevel | null = req.effort ?? profileEffort
 820      const effortOpt: Pick<LaunchOptions, 'effort'> = effortValue ? { effort: effortValue } : {}
 821      const envOpt: Pick<LaunchOptions, 'envAdditions'> =
 822        Object.keys(profileEnv).length > 0 ? { envAdditions: profileEnv } : {}
 823      let launchOpts: LaunchOptions = { ...effortOpt, ...envOpt }
 824      // 3a-3 (D42): what attribution decided for this launch, carried to
 825      // linkDispatch once the dispatch row exists. Holds a HASH and two numbers —
 826      // never key material.
 827      let mint: MintForDispatchResult = { credential: null, pending: null, stateIfNoMint: null }
 828      if (credentialProfileId) {
 829        // ⚠ REUSE, DO NOT FORK. Exactly one function in main calls
 830        // vault.decryptForLaunch for a launch, so D33 clause 8's refusals have
 831        // exactly one place to live and cannot drift.
 832        const resolved = await resolveCredential(credentialProfileId, req.agent)
 833        if (!resolved.ok) return { ok: false, reason: resolved.reason }
 834        // ⚠ THE ONE PLACE A KEY IS MINTED, and the branch that decides is inside
 835        // mintForDispatch, keyed on AuthMethodDefinition.type. A null authType
 836        // (an auth_mode no adapter declares) mints NOTHING — it degrades to
 837        // 'none' rather than guessing.
 838        mint = await attribution.mintForDispatch({
 839          authType: resolved.authType ?? 'subscription',
 840          hasRoute: resolved.route !== null,
 841          userCredential: resolved.credential
 842        })
 843        // The MINTED key replaces the user's — which means, on an attributed
 844        // launch, the user's long-lived key is decrypted but never injected. The
 845        // route is unchanged: it is non-secret argv metadata and does not depend
 846        // on which key is used.
 847        const credential = mint.credential ?? resolved.credential
 848        // D90: RANK 0 of D56's precedence order — the model chosen for THIS
 849        // launch, applied here and nowhere else.
 850        //
 851        // ⚠ IT OVERRIDES THE ROUTE'S `modelId` FIELD AND WRITES NOTHING. The
 852        // route object is rebuilt as a fresh literal with one field replaced;
 853        // `provider_configs` is untouched, exactly as it is by every other rank
 854        // (grep this handler for `UPDATE provider_configs`: zero). The stored
 855        // default survives the launch unchanged, which is what makes this a
 856        // choice for today rather than D48's second home for the same fact.
 857        //
 858        // ⚠ ORDER: payload > launch profile > route default. The payload wins for
 859        // the same reason it already wins for `effort` a few lines above — it is
 860        // what the user is looking at in the dialog; the stored rows are the
 861        // defaults the dialog prefilled from.
 862        const chosenModel = req.model ?? profileModel
 863        const route =
 864          resolved.route && chosenModel
 865            ? { ...resolved.route, modelId: chosenModel }
 866            : resolved.route
 867        launchOpts = {
 868          ...effortOpt,
 869          ...envOpt,
 870          secrets: [credential.value],
 871          credential,
 872          ...(route ? { route } : {})
 873        }
 874      } else {
 875        // No profile named: a subscription or ambient-env launch (D33 resolution
 876        // c — the FIRST-CLASS path, not a fallback). It is passed through
 877        // mintForDispatch anyway so the row still gets an honest state, and it
 878        // CANNOT mint: the subscription branch returns before anything else is
 879        // read.
 880        mint = await attribution.mintForDispatch({
 881          authType: 'subscription',
 882          hasRoute: false,
 883          userCredential: null
 884        })
 885      }
 886      // Task 3a-5 / D49: the credentialed fact is now the session's own
 887      // `launch_profile_id`, written on the SAME INSERT as the row (below, in all
 888      // three workspace-mode branches) rather than marked afterwards.
 889      //
 890      // ⚠ THAT ORDERING IS THE POINT. 3-6 marked the row AFTER a successful
 891      // launch, which left a window in which a crash produced a live credentialed
 892      // session with no mark — the silent-keyless-restore failure. Same-insert
 893      // closes it structurally, and the fact now dies with the row, so
 894      // session:delete needs no unmark call at all.
 895      //
 896      // A launch with no credential at all writes NULL, which the fail-safe
 897      // predicate reads as "not credentialed" — correct, because there was no
 898      // credential to lose.
 899      //
 900      // ⚠ A LAUNCH ON A BARE CREDENTIAL WITH NO PROFILE WRITES THE SENTINEL, NOT
 901      // NULL. That path is still first-class (D33 clause 9 / the 3-6 dialog
 902      // flow), and such a session IS credentialed but has no profile to point at.
 903      // Writing NULL would make sessionIsCredentialed return FALSE and the
 904      // restore engine would relaunch it KEYLESS — reintroducing the exact F26
 905      // failure Task 3-6's global list existed to prevent, through the retirement
 906      // that was supposed to preserve it. The sentinel says "credentialed, and
 907      // Chorus cannot reproduce this launch", which is the honest statement and
 908      // is what makes Relaunch correctly refuse it with the use-the-dialog
 909      // message.
 910      const sessionProfilePointer: string | null =
 911        launchProfileId ?? (credentialProfileId ? LEGACY_CREDENTIALED_PROFILE_ID : null)
 912      // 3a-3: the write-ahead ledger write. Called IMMEDIATELY after
 913      // sessions.launch(...) returns, because 3a-1's DispatchRecorder creates the
 914      // dispatches row on the onStart announcement fired synchronously INSIDE
 915      // that call — before it there is no row to write a ledger onto, and this
 916      // service is forbidden from creating one. See dispatchAttribution.ts's
 917      // linkDispatch for the full ordering argument and what the residual window
 918      // costs (matrix row 3, bounded by the hard $0.50 limit).
 919      const linkAttribution = (sessionId: string): void => {
 920        attribution.linkDispatch(sessionId, mint.pending, mint.stateIfNoMint)
 921      }
 922  
 923      // 2-2 (D22/D26f): the chosen workspace_mode is authoritative. Main
 924      // validates it and returns {ok:false} inline on any failure — NEVER a
 925      // silent fallback to another mode.
 926      if (req.workspace_mode === 'new-worktree') {
 927        // The mode is validated against the ACTUAL cwd, not the (project-root)
 928        // suggestion — the dialog's default may be stale for a typed cwd.
 929        const repoRoot = await resolveRepoRoot(req.cwd)
 930        if (repoRoot === null) {
 931          return { ok: false, reason: `Not a git repository: ${req.cwd}` }
 932        }
 933        const baseBranch = await currentBranch(repoRoot)
 934        // F16 (FKs enforced): the sessions row MUST exist before createWorktree
 935        // inserts its journal row carrying session_id — row-before-worktree is
 936        // mandatory, not stylistic. cwd starts as req.cwd; activation rewrites
 937        // it to the worktree path in the same transaction as both pointers.
 938        const row = storage.createSession({
 939          id: randomUUID(),
 940          projectId: p.id,
 941          agent: req.agent,
 942          cwd: req.cwd,
 943          status: 'running',
 944          exitCode: null,
 945          createdAt: new Date().toISOString(),
 946          launchProfileId: sessionProfilePointer
 947        })
 948        let wt: WorktreeRow
 949        try {
 950          wt = await worktrees.createWorktree(row.id, repoRoot, baseBranch) // DB-first journal (2-1)
 951        } catch (err) {
 952          // createWorktree deletes its own journal row on every failure branch,
 953          // so deleting the never-surfaced session row cannot trip the F16 FK
 954          // (no leaf, no pane ever saw it — pure debris). Do NOT reorder.
 955          storage.deleteSession(row.id)
 956          return {
 957            ok: false,
 958            reason: `Worktree creation failed: ${err instanceof Error ? err.message : String(err)}`
 959          }
 960        }
 961        // Resolution (a): both pointers + status='active' + session cwd →
 962        // worktree path, in ONE synchronous transaction.
 963        storage.activateWorktreeForSession(wt.id, row.id, wt.path)
 964        const snap = sessions.launch(req.agent, wt.path, row.id, launchOpts) // spawn IN the worktree
 965        linkAttribution(row.id)
 966        if (launchProfileId) storage.setLastLaunchProfileId(p.id, launchProfileId)
 967        storage.pushRecentCwd(req.cwd)
 968        return launchResponseSchema.parse({
 969          ...snap,
 970          title: row.title,
 971          branch: wt.branch,
 972          worktreeId: wt.id
 973        })
 974      }
 975  
 976      if (req.workspace_mode === 'existing-worktree') {
 977        // Attachability is enforced here, independently of what the picker
 978        // offered: the row must exist, belong to THIS project, be in a settled
 979        // state, not be owned by a live session, and still be on disk.
 980        const wt = req.worktree_id ? storage.getWorktreeById(req.worktree_id) : null
 981        if (!wt) return { ok: false, reason: 'Select an existing worktree to attach' }
 982        if (wt.projectId !== p.id) {
 983          return { ok: false, reason: 'That worktree belongs to another project' }
 984        }
 985        if (wt.status !== 'detached' && wt.status !== 'active') {
 986          return { ok: false, reason: `That worktree is not attachable (status: ${wt.status})` }
 987        }
 988        if (wt.sessionId !== null && sessions.isRunning(wt.sessionId)) {
 989          return { ok: false, reason: 'That worktree is in use by a live session' }
 990        }
 991        if (!fs.existsSync(wt.path)) {
 992          return { ok: false, reason: `Worktree directory is gone: ${wt.path}` }
 993        }
 994        const row = storage.createSession({
 995          id: randomUUID(),
 996          projectId: p.id,
 997          agent: req.agent,
 998          cwd: wt.path,
 999          status: 'running',
1000          exitCode: null,
1001          createdAt: new Date().toISOString(),
1002          launchProfileId: sessionProfilePointer
1003        })
1004        storage.activateWorktreeForSession(wt.id, row.id, wt.path) // re-own, one txn
1005        const snap = sessions.launch(req.agent, wt.path, row.id, launchOpts)
1006        linkAttribution(row.id)
1007        if (launchProfileId) storage.setLastLaunchProfileId(p.id, launchProfileId)
1008        return launchResponseSchema.parse({
1009          ...snap,
1010          title: row.title,
1011          branch: wt.branch,
1012          worktreeId: wt.id
1013        })
1014      }
1015  
1016      // current-tree — the pre-2-2 launch path, unchanged.
1017      const row = storage.createSession({
1018        id: randomUUID(),
1019        projectId: p.id,
1020        agent: req.agent,
1021        cwd: req.cwd,
1022        status: 'running',
1023        exitCode: null,
1024        createdAt: new Date().toISOString(),
1025        launchProfileId: sessionProfilePointer
1026      })
1027      const snap = sessions.launch(req.agent, req.cwd, row.id, launchOpts)
1028      linkAttribution(row.id)
1029      if (launchProfileId) storage.setLastLaunchProfileId(p.id, launchProfileId)
1030      storage.pushRecentCwd(req.cwd)
1031      // Fresh row: title is NULL until a capture event lands (1b-1).
1032      return launchResponseSchema.parse({ ...snap, title: row.title, branch: null, worktreeId: null })
1033    })
1034  
1035    ipcMain.handle(
1036      IpcChannel.SessionLaunchContext,
1037      async (_event, payload): Promise<LaunchContextResponse> => {
1038        const req = launchContextRequestSchema.parse(payload)
1039        const p = requireProject(req.project_id)
1040        // 2-2 (D26f): repo context for the workspace-mode default, computed in
1041        // main against the PROJECT ROOT (the dialog's default cwd — a typed cwd
1042        // change does not re-fetch; main re-validates the chosen mode against
1043        // the actual cwd at launch). resolveRepoRoot never throws: a non-git
1044        // project root yields null (findings risk 3) → current-tree only.
1045        const repoRoot = await resolveRepoRoot(p.rootPath)
1046  
1047        let liveSessionsInRepo = 0
1048        let pickable: PickableWorktree[] = []
1049        if (repoRoot !== null) {
1050          const repoKey = pathKey(repoRoot)
1051          // OTHER live sessions writing the same MAIN tree: iterate the
1052          // project's rows and ask the manager (isRunning — no SessionManager
1053          // API growth; exited rows never count). A live session inside a
1054          // WORKTREE does NOT match repoRoot: --show-toplevel there returns the
1055          // worktree's OWN toplevel, so already-isolated agents are excluded —
1056          // the intended D22 semantics, do not "fix" with --git-common-dir.
1057          for (const row of storage.getSessionsForProject(p.id)) {
1058            if (!sessions.isRunning(row.id)) continue
1059            const rowRoot = await resolveRepoRoot(row.cwd)
1060            if (rowRoot !== null && pathKey(rowRoot) === repoKey) liveSessionsInRepo++
1061          }
1062          // Pickable: detached, or active with no live owning session.
1063          pickable = storage
1064            .getWorktreesForProject(p.id)
1065            .filter((w) => pathKey(w.repoRoot) === repoKey)
1066            .filter(
1067              (w) =>
1068                w.status === 'detached' ||
1069                (w.status === 'active' && !(w.sessionId !== null && sessions.isRunning(w.sessionId)))
1070            )
1071            .map(
1072              (w): PickableWorktree => ({ id: w.id, branch: w.branch, path: w.path, status: w.status })
1073            )
1074        }
1075  
1076        // Outbound parse re-filters recent cwds to strings: the renderer never
1077        // trusts raw disk contents.
1078        return launchContextResponseSchema.parse({
1079          projectRoot: p.rootPath,
1080          recentCwds: storage.getRecentCwds(),
1081          repoRoot,
1082          liveSessionsInRepo,
1083          suggestedMode: suggestMode(repoRoot, liveSessionsInRepo),
1084          worktrees: pickable,
1085          // Task 3a-5: the picker's rows ride in on this existing call — no
1086          // fifth round trip (spec §8.1).
1087          launchProfiles: listLaunchProfileWire(),
1088          // ⚠ A DANGLING pointer resolves to null, NEVER to a label match: the
1089          // profile was deleted, so there is no default, and the dialog behaves
1090          // exactly as it does today. Computed in MAIN — the renderer never
1091          // derives a default and never persists one.
1092          lastLaunchProfileId: (() => {
1093            const id = storage.getLastLaunchProfileId(p.id)
1094            return id && storage.getLaunchProfileById(id) ? id : null
1095          })()
1096        })
1097      }
1098    )
1099  
1100    ipcMain.handle(IpcChannel.SessionRestart, (_event, payload): RestartResponse => {
1101      const { sessionId } = restartRequestSchema.parse(payload)
1102      // D16 clause 4: one path for in-run and post-restart restarts. Read the
1103      // row, re-validate cwd, spawn via the launch path under the SAME row id
1104      // (no row creation), write 'running' only after the spawn succeeds.
1105      const row = storage.getSessionById(sessionId)
1106      if (!row) return { ok: false, reason: `Unknown sessionId: ${sessionId}` }
1107      if (sessions.isRunning(sessionId)) {
1108        return { ok: false, reason: 'Session is still running — kill it before restarting' }
1109      }
1110      if (!fs.existsSync(row.cwd)) {
1111        return { ok: false, reason: `Working directory not found: ${row.cwd}` }
1112      }
1113      // D34(c): an unknown persisted agent is a REFUSAL, not a throw. There is
1114      // no 'failed' session status (running|exited only) and no notification
1115      // centre until Phase 4, so the unknown-agent rule maps onto what exists:
1116      // an inline {ok:false} here, and the D16 spawn-failure heal path at
1117      // restore. sessions.agent is a TEXT column and can hold anything.
1118      const adapter = getAdapter(row.agent)
1119      if (!adapter) {
1120        return { ok: false, reason: `Unknown agent '${row.agent}' — this session cannot be restarted.` }
1121      }
1122      // Task 3-6 Step 7 (decision b): a credential-bearing session is never
1123      // relaunched keyless — not by the restore engine (healed to exited
1124      // chrome) and not by a manual restart. Restarting here would spawn on
1125      // AMBIENT credentials while the user believes the session runs on their
1126      // profile; the honest answer is an inline refusal.
1127      //
1128      // Task 3a-5: the PREDICATE's source changed (derived per-session from the
1129      // launch profile) and the MESSAGE is byte-identical, deliberately. Restart
1130      // and Relaunch are different verbs — restart means "same configuration, NO
1131      // credential"; relaunch means "same configuration, credential RE-RESOLVED
1132      // because you asked" — and this refusal is what makes the difference
1133      // legible. Changing it would be a gratuitous user-visible diff in a task
1134      // whose whole claim is that behaviour did not regress.
1135      if (storage.isSessionCredentialed(sessionId)) {
1136        return {
1137          ok: false,
1138          reason:
1139            'This session ran on a stored credential, which Chorus never re-supplies automatically. Launch a new session from the launch dialog to re-enter it.'
1140        }
1141      }
1142      try {
1143        // The cast is now justified by the registry lookup immediately above.
1144        const snap = sessions.launch(row.agent as AgentKind, row.cwd, row.id)
1145        storage.updateSessionStatus(sessionId, 'running', null)
1146        return restartResponseSchema.parse({
1147          ...snap,
1148          title: row.title,
1149          branch: branchForSession(row.id, row.projectId),
1150          worktreeId: worktreeForSession(row.id, row.projectId)?.id ?? null
1151        })
1152      } catch (err) {
1153        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
1154      }
1155    })
1156  
1157    ipcMain.handle(IpcChannel.SessionDelete, (_event, payload): void => {
1158      const { sessionId } = deleteSessionRequestSchema.parse(payload)
1159      // Pane close ordering is kill -> awaited exit -> leaf removed -> delete;
1160      // a live PTY must never lose its row (the invisible-process guard's twin:
1161      // no PTY may exist that no pane can reach).
1162      if (sessions.isRunning(sessionId)) {
1163        throw new Error(`Refusing to delete live session: ${sessionId} (kill it first)`)
1164      }
1165      // 2-3 (F16/F18): detach any worktree this session owns BEFORE deleting the
1166      // row, keyed off the AUTHORITATIVE worktrees side (worktrees.session_id —
1167      // D26(a)), never sessions.worktree_id alone: crash windows and re-owns
1168      // leave that pointer NULL/stale while the enforced FK still bites.
1169      // detachWorktree clears BOTH pointers in ONE transaction (resolution a).
1170      // This step is LOAD-BEARING, not tidiness: better-sqlite3 enforces FKs
1171      // (default RESTRICT), so deleteSession throws while any worktrees row
1172      // references this session. The handler only ever DETACHES — the
1173      // remove-when-clean offer is renderer UX and runs before this call.
1174      const row = storage.getSessionById(sessionId)
1175      if (row) {
1176        for (const w of storage.getWorktreesForProject(row.projectId)) {
1177          if (w.sessionId === sessionId) storage.detachWorktree(w.id)
1178        }
1179      }
1180      // Task 3a-5: NOTHING unmarks the session here any more. The credentialed
1181      // fact lives in the row's own launch_profile_id, so it dies with the row —
1182      // structurally, rather than because a handler remembered to clear it.
1183      storage.deleteSession(sessionId)
1184    })
1185  
1186    /* ------------------------------------------------------------------ */
1187    /* Task 2-3: worktree cleanup channels (D26 clauses 5-8, Q4, (i), (j)) */
1188    /* ------------------------------------------------------------------ */
1189  
1190    ipcMain.handle(IpcChannel.WorktreeList, async (_event, payload): Promise<WorktreeSummary[]> => {
1191      const { project_id } = worktreeListRequestSchema.parse(payload)
1192      const p = requireProject(project_id)
1193  
1194      // F19 (2-3): the panel must surface what the table does not know about.
1195      // Same union scan the boot reconcile now runs — adopt managed worktrees
1196      // with a git entry but no row (population 4, the boot reconcile's own
1197      // rule applied to post-boot discoveries) and collect orphan directories
1198      // (population 5) for informational surfacing. Rows from the table alone
1199      // would leave a fresh/external worktree invisible here.
1200      const orphanDirs: string[] = []
1201      const repoRoot = await resolveRepoRoot(p.rootPath)
1202      if (repoRoot !== null) {
1203        try {
1204          const managedRoot = worktreeRootFor(repoRoot)
1205          const managedKey = pathKey(managedRoot)
1206          const gitEntries = (await listWorktrees(repoRoot)).filter((e) =>
1207            pathKey(e.path).startsWith(`${managedKey}\\`)
1208          )
1209          const rowKeys = new Set(storage.getWorktreesForProject(p.id).map((r) => pathKey(r.path)))
1210          for (const entry of gitEntries) {
1211            if (rowKeys.has(pathKey(entry.path))) continue
1212            // Population 4b (git metadata for a vanished dir, no row): the boot
1213            // reconcile logs it as a prune candidate; nothing here to act on.
1214            if (!fs.existsSync(entry.path)) continue
1215            storage.createWorktreeRow({
1216              id: randomUUID(),
1217              projectId: p.id,
1218              sessionId: null,
1219              path: path.win32.normalize(entry.path),
1220              branch: entry.branch ?? '',
1221              baseBranch: '',
1222              repoRoot,
1223              status: 'detached',
1224              createdAt: new Date().toISOString()
1225            })
1226            logger.info(`[worktrees] list: found untracked worktree ${entry.path}; adopted as detached`)
1227            rowKeys.add(pathKey(entry.path))
1228          }
1229          const entryKeys = new Set(gitEntries.map((e) => pathKey(e.path)))
1230          if (fs.existsSync(managedRoot)) {
1231            for (const d of fs.readdirSync(managedRoot, { withFileTypes: true })) {
1232              if (!d.isDirectory()) continue
1233              const dir = path.join(managedRoot, d.name)
1234              if (!entryKeys.has(pathKey(dir)) && !rowKeys.has(pathKey(dir))) orphanDirs.push(dir)
1235            }
1236          }
1237        } catch (err) {
1238          logger.warn({ err }, '[worktrees] list: repo scan failed; listing table rows only')
1239        }
1240      }
1241  
1242      const out: WorktreeSummary[] = []
1243      for (const w of storage.getWorktreesForProject(p.id)) {
1244        const dirGone = !fs.existsSync(w.path)
1245        // A status read can fail on a row whose dir lost its git metadata (P3);
1246        // treat it as DIRTY so removal still requires the typed token — the
1247        // protective default, and the panel stays loadable.
1248        const dirty = dirGone ? [] : await worktrees.getDirtyFiles(w.path).catch(() => ['(unreadable)'])
1249        // Adopted rows carry branch/baseBranch '' — an empty ref fails
1250        // rev-list, so skip git there; -1/-1 tells the panel to render —
1251        // instead of counts (also for prune candidates and git read failures).
1252        const { ahead, behind } =
1253          dirGone || w.branch === '' || w.baseBranch === ''
1254            ? { ahead: -1, behind: -1 }
1255            : await aheadBehind(w.repoRoot, w.branch, w.baseBranch).catch(() => ({
1256                ahead: -1,
1257                behind: -1
1258              }))
1259        out.push({
1260          id: w.id,
1261          path: w.path,
1262          branch: w.branch,
1263          status: w.status,
1264          clean: !dirGone && dirty.length === 0,
1265          dirtyCount: dirty.length,
1266          ahead,
1267          behind,
1268          isPruneCandidate: dirGone // population-2 surfacing (dir gone, git meta may remain)
1269        })
1270      }
1271      // Population 5 (orphan directories): surfaced INFORMATIONALLY with the
1272      // nil-uuid sentinel (no row exists). Reconcile never auto-deletes them —
1273      // they may be agent output, not debris — and the panel gives them no
1274      // action affordance (removal would be bespoke recursive fs deletion,
1275      // the data-loss surface D26(i) rejected for worktree removal).
1276      for (const dir of orphanDirs) {
1277        out.push({
1278          id: '00000000-0000-0000-0000-000000000000',
1279          path: dir,
1280          branch: '',
1281          status: 'orphan-dir',
1282          clean: true,
1283          dirtyCount: 0,
1284          ahead: -1,
1285          behind: -1,
1286          isPruneCandidate: true
1287        })
1288      }
1289      return worktreeListResponseSchema.parse(out)
1290    })
1291  
1292    ipcMain.handle(IpcChannel.WorktreeDirtyFiles, async (_event, payload): Promise<string[]> => {
1293      const { worktreeId } = worktreeDirtyFilesRequestSchema.parse(payload)
1294      const w = storage.getWorktreeById(worktreeId)
1295      if (!w || !fs.existsSync(w.path)) return []
1296      return worktreeDirtyFilesResponseSchema.parse(await worktrees.getDirtyFiles(w.path))
1297    })
1298  
1299    // Task 2-4: READ-ONLY diff summary for the pane header. Worktree resolution
1300    // goes through worktreeForSession (worktrees.session_id, F18 resolution a) —
1301    // the IDENTICAL path as the branch label, so the two can never disagree
1302    // about whether a session is in a worktree (a crash-window promote leaves
1303    // sessions.worktree_id NULL while the row-side pointer stands). No staging,
1304    // no commit, no merge, no removal, no --force: git diff + git status only.
1305    ipcMain.handle(
1306      IpcChannel.WorktreeDiffSummary,
1307      async (_event, payload): Promise<WorktreeDiffSummary | null> => {
1308        const { sessionId } = worktreeDiffRequestSchema.parse(payload)
1309        const row = storage.getSessionById(sessionId)
1310        if (!row) return null
1311        const wt = worktreeForSession(sessionId, row.projectId)
1312        if (!wt || !fs.existsSync(wt.path)) return null
1313        const stat = await diffShortstat(wt.path)
1314        const untracked = (await statusPorcelain(wt.path)).filter((l) => l.startsWith('??')).length
1315        return worktreeDiffResponseSchema.parse({ ...stat, untracked })
1316      }
1317    )
1318  
1319    ipcMain.handle(IpcChannel.WorktreeRemove, async (_event, payload): Promise<WorktreeRemoveResponse> => {
1320      const req = worktreeRemoveRequestSchema.parse(payload)
1321      const w = storage.getWorktreeById(req.worktreeId)
1322      if (!w) return worktreeRemoveResponseSchema.parse({ ok: false, reason: 'Worktree not found' })
1323      // The owning session must not be live (D26 clause 8: removal sequences
1324      // after the process tree has exited).
1325      if (w.sessionId && sessions.isRunning(w.sessionId)) {
1326        return worktreeRemoveResponseSchema.parse({
1327          ok: false,
1328          reason: 'Kill the owning session before removing its worktree'
1329        })
1330      }
1331      // LIVE cleanliness re-check (D26 clause 6): the renderer's fresh read
1332      // narrows the race window; this re-check closes it. Never trust the
1333      // panel's list-time clean flag — it may be hours stale.
1334      const dirGone = !fs.existsSync(w.path)
1335      const clean =
1336        dirGone || (await worktrees.getDirtyFiles(w.path).catch(() => ['(unreadable)'])).length === 0
1337      if (!dirtyRemovalAllowed({ path: w.path, clean }, req.confirmation)) {
1338        return worktreeRemoveResponseSchema.parse({
1339          ok: false,
1340          reason: 'Type the worktree path to confirm removing uncommitted work'
1341        })
1342      }
1343      try {
1344        await worktrees.removeWorktree(w.id, {
1345          deleteBranch: req.deleteBranch,
1346          // D26(i): --force reaches git ONLY here — the gated dirty-removal
1347          // path, after the live re-check AND the typed token. Every other
1348          // caller passes forceDirty: false.
1349          forceDirty: !clean,
1350          // D26(j) as amended by F21: -D escalation is licensed by its OWN
1351          // acknowledgment naming the branch. The dirty-removal token no longer
1352          // reaches this decision — a main-side gate, so the escalation is
1353          // unreachable regardless of what any renderer sends.
1354          forceBranch: branchForceAllowed(w, req.branchForceConfirmation)
1355        })
1356      } catch (err) {
1357        // A genuine removal failure leaves the row journaled 'removing' —
1358        // revert so the panel keeps offering it. (A branch-deletion refusal
1359        // deletes the row inside removeWorktree first, making this a no-op
1360        // there; the surfaced message still reaches the user.)
1361        storage.updateWorktreeStatus(w.id, 'detached')
1362        return worktreeRemoveResponseSchema.parse({
1363          ok: false,
1364          reason: err instanceof Error ? err.message : String(err)
1365        })
1366      }
1367      return worktreeRemoveResponseSchema.parse({ ok: true })
1368    })
1369  
1370    /* ------------------------------------------------------------------ */
1371    /* Task 3-2: providers + credential vault (D33)                        */
1372    /* ------------------------------------------------------------------ */
1373  
1374    ipcMain.handle(IpcChannel.ProviderList, (_event, payload): ProviderListResponse => {
1375      providerListRequestSchema.parse(payload ?? {})
1376      return providerListResponseSchema.parse(storage.listProviderConfigs().map(toWireProvider))
1377    })
1378  
1379    ipcMain.handle(IpcChannel.ProviderCreate, (_event, payload): ProviderCreateResponse => {
1380      const req = providerCreateRequestSchema.parse(payload)
1381      // spec §6.4: provider-level headers are PLAINTEXT (documented non-secret,
1382      // D33 resolution e) — a credential pasted here defeats the design. Refuse
1383      // and redirect the user to a credential profile, where it is encrypted.
1384      if (headersContainSecret(req.extra_headers_json)) {
1385        return providerCreateResponseSchema.parse({
1386          ok: false,
1387          reason: PROVIDER_HEADERS_SECRET_REFUSAL
1388        })
1389      }
1390      const row = storage.createProviderConfig({
1391        id: randomUUID(),
1392        name: req.name,
1393        adapterType: req.adapter_type,
1394        authMode: req.auth_mode,
1395        envVarName: req.env_var_name ?? null,
1396        baseUrl: req.base_url ?? null,
1397        extraHeadersJson: req.extra_headers_json ?? null,
1398        model: req.model ?? null,
1399        createdAt: new Date().toISOString()
1400      })
1401      return providerCreateResponseSchema.parse({ ok: true, provider: toWireProvider(row) })
1402    })
1403  
1404    ipcMain.handle(IpcChannel.ProviderUpdate, (_event, payload): ProviderUpdateResponse => {
1405      const req = providerUpdateRequestSchema.parse(payload)
1406      if (!storage.getProviderConfigById(req.id)) {
1407        return providerUpdateResponseSchema.parse({ ok: false, reason: 'Provider not found' })
1408      }
1409      if (headersContainSecret(req.extra_headers_json)) {
1410        return providerUpdateResponseSchema.parse({
1411          ok: false,
1412          reason: PROVIDER_HEADERS_SECRET_REFUSAL
1413        })
1414      }
1415      // Patch semantics: absent = unchanged; null = clear; a value = set.
1416      const patch: Partial<Omit<NewProviderConfigRow, 'id' | 'createdAt'>> = {}
1417      if (req.name !== undefined) patch.name = req.name
1418      if (req.adapter_type !== undefined) patch.adapterType = req.adapter_type
1419      if (req.auth_mode !== undefined) patch.authMode = req.auth_mode
1420      if (req.env_var_name !== undefined) patch.envVarName = req.env_var_name
1421      if (req.base_url !== undefined) patch.baseUrl = req.base_url
1422      if (req.extra_headers_json !== undefined) patch.extraHeadersJson = req.extra_headers_json
1423      if (req.model !== undefined) patch.model = req.model
1424      storage.updateProviderConfig(req.id, patch)
1425      return providerUpdateResponseSchema.parse({ ok: true })
1426    })
1427  
1428    ipcMain.handle(IpcChannel.ProviderDelete, (_event, payload): ProviderDeleteResponse => {
1429      const { id } = providerDeleteRequestSchema.parse(payload)
1430      const existing = storage.getProviderConfigById(id)
1431      if (!existing) {
1432        return providerDeleteResponseSchema.parse({ ok: false, reason: 'Provider not found' })
1433      }
1434      // F16: credential_profiles.provider_id REFERENCES provider_configs(id) is
1435      // ENFORCED (default RESTRICT) — count-and-refuse BEFORE SQLite can throw,
1436      // never reverse-engineer a caught SQLITE_CONSTRAINT_FOREIGNKEY into a user
1437      // message (the failure mode Task 2-3 already paid for once).
1438      const referencing = storage.countCredentialProfilesForProvider(id)
1439      if (referencing > 0) {
1440        return providerDeleteResponseSchema.parse({
1441          ok: false,
1442          reason: `Provider '${existing.name}' still has ${referencing} credential profile${referencing === 1 ? '' : 's'} — delete ${referencing === 1 ? 'it' : 'them'} first`
1443        })
1444      }
1445      // Task 3a-5: the SECOND count on this handler. launch_profiles.provider_id
1446      // REFERENCES provider_configs(id) and is likewise ENFORCED, so it needs its
1447      // own authored refusal for exactly the same reason. (3a-4's model_catalog
1448      // needs none: it deliberately carries NO REFERENCES and is purged
1449      // explicitly inside deleteProviderConfig's own transaction — a cache must
1450      // not block a user flow, an instruction must.)
1451      const profilesUsing = storage.countLaunchProfilesForProvider(id)
1452      if (profilesUsing > 0) {
1453        return providerDeleteResponseSchema.parse({
1454          ok: false,
1455          reason: `Provider '${existing.name}' is used by ${profilesUsing} launch profile${profilesUsing === 1 ? '' : 's'} — delete ${profilesUsing === 1 ? 'it' : 'them'} first`
1456        })
1457      }
1458      storage.deleteProviderConfig(id)
1459      return providerDeleteResponseSchema.parse({ ok: true })
1460    })
1461  
1462    ipcMain.handle(IpcChannel.CredentialList, (_event, payload): CredentialListResponse => {
1463      credentialListRequestSchema.parse(payload ?? {})
1464      // Two independent barriers keep key material off the wire: toProfileMeta's
1465      // explicit construction inside the vault, then this OUTBOUND parse — a
1466      // handler returning a raw row (blob, fingerprint) fails loudly HERE.
1467      return credentialListResponseSchema.parse(vault.listProfiles())
1468    })
1469  
1470    // credential:create is NEVER logged — not at any level, behind any flag
1471    // (D33 redaction rule 4). The plaintext key enters exactly here, travels
1472    // renderer -> main once, and no response field ever carries it back.
1473    ipcMain.handle(IpcChannel.CredentialCreate, (_event, payload): CredentialCreateResponse => {
1474      const req = credentialCreateRequestSchema.parse(payload)
1475      if (!storage.getProviderConfigById(req.providerId)) {
1476        return credentialCreateResponseSchema.parse({ ok: false, reason: 'Provider not found' })
1477      }
1478      const result = vault.createProfile({
1479        providerId: req.providerId,
1480        label: req.label,
1481        key: req.key,
1482        baseUrl: req.baseUrl,
1483        extraHeaders: req.extraHeaders
1484      })
1485      return credentialCreateResponseSchema.parse(
1486        result.ok ? { ok: true, id: result.value.id } : { ok: false, reason: result.message }
1487      )
1488    })
1489  
1490    // credential:replace — same write-only discipline as create; never logged.
1491    ipcMain.handle(IpcChannel.CredentialReplace, (_event, payload): CredentialReplaceResponse => {
1492      const req = credentialReplaceRequestSchema.parse(payload)
1493      const result = vault.replaceProfile(req.id, {
1494        key: req.key,
1495        baseUrl: req.baseUrl,
1496        extraHeaders: req.extraHeaders
1497      })
1498      return credentialReplaceResponseSchema.parse(
1499        result.ok ? { ok: true } : { ok: false, reason: result.message }
1500      )
1501    })
1502  
1503    ipcMain.handle(IpcChannel.CredentialDelete, (_event, payload): CredentialDeleteResponse => {
1504      const { id } = credentialDeleteRequestSchema.parse(payload)
1505      if (!storage.getCredentialProfileById(id)) {
1506        return credentialDeleteResponseSchema.parse({ ok: false, reason: 'Credential profile not found' })
1507      }
1508      // ⚠ Task 3a-5: this handler had NO GUARD AT ALL before now, and did not
1509      // need one — nothing referenced credential_profiles. launch_profiles does,
1510      // with an ENFORCED FK, so without this count SQLite would throw
1511      // SQLITE_CONSTRAINT_FOREIGNKEY straight through a flow that has worked
1512      // since Task 3-2. Count and refuse BEFORE the statement runs; never
1513      // reverse-engineer the throw into a user message.
1514      //
1515      // ⚠ Task 3b-2 adds ONE COUNT to this guard; it does NOT add a second guard
1516      // and does NOT replace the one above. `council_members.credential_profile_id`
1517      // carries a REAL, ENFORCED `REFERENCES` for exactly the same reason
1518      // `launch_profiles` does (D62: a member is a live INSTRUCTION, not a
1519      // historical fact), so a credential can now be held by BOTH kinds of row and
1520      // both must be counted before the statement runs.
1521      //
1522      // The two counts are named DISTINCTLY in the refusal, because "used by 2
1523      // things" does not tell a user what to go and delete.
1524      const usedByProfiles = storage.countLaunchProfilesForCredential(id)
1525      const usedByMembers = storage.countCouncilMembersForCredential(id)
1526      if (usedByProfiles > 0 || usedByMembers > 0) {
1527        const parts: string[] = []
1528        if (usedByProfiles > 0) {
1529          parts.push(`${usedByProfiles} launch profile${usedByProfiles === 1 ? '' : 's'}`)
1530        }
1531        if (usedByMembers > 0) {
1532          parts.push(`${usedByMembers} council member${usedByMembers === 1 ? '' : 's'}`)
1533        }
1534        const total = usedByProfiles + usedByMembers
1535        return credentialDeleteResponseSchema.parse({
1536          ok: false,
1537          reason: `This credential is used by ${parts.join(' and ')} — delete ${total === 1 ? 'it' : 'them'} first`
1538        })
1539      }
1540      vault.deleteProfile(id)
1541      return credentialDeleteResponseSchema.parse({ ok: true })
1542    })
1543  
1544    // Task 3-6 test-key (D33 resolution d): ONE live auth probe, fired ONLY by
1545    // the renderer's Test-key button — never at boot, at launch, on a timer, or
1546    // on profile creation ("at your request" is load-bearing). The response is
1547    // a boolean plus a sanitized message; on success last_verified_at updates
1548    // (markCredentialVerified's one caller).
1549    ipcMain.handle(IpcChannel.CredentialTest, async (_event, payload): Promise<CredentialTestResponse> => {
1550      const { id } = credentialTestRequestSchema.parse(payload)
1551      const profile = storage.getCredentialProfileById(id)
1552      if (!profile) {
1553        return credentialTestResponseSchema.parse({ ok: false, reason: 'That credential profile no longer exists.' })
1554      }
1555      const provider = storage.getProviderConfigById(profile.providerId)
1556      if (!provider) {
1557        return credentialTestResponseSchema.parse({
1558          ok: false,
1559          reason: 'The provider for this credential profile no longer exists.'
1560        })
1561      }
1562      const dec = await vault.decryptForLaunch(id)
1563      if (!dec.ok) return credentialTestResponseSchema.parse({ ok: false, reason: dec.message })
1564      const result = await probeCredential(dec.value, provider)
1565      if (result.ok) storage.markCredentialVerified(id, new Date().toISOString())
1566      return credentialTestResponseSchema.parse(result.ok ? { ok: true } : { ok: false, reason: result.reason })
1567    })
1568  
1569    /* ------------------------------------------------------------------ */
1570    /* Task 3a-4: the model catalog. Registered HERE, immediately after the */
1571    /* test-key handler, so the app's two live-call channels sit together   */
1572    /* and a reviewer reads them as a pair.                                 */
1573    /*                                                                      */
1574    /* ⚠ NEITHER HANDLER WRITES provider_configs. The catalog is a list of  */
1575    /* what exists — never authoritative over the route's default model, and */
1576    /* a catalog miss warns rather than clearing, defaulting or             */
1577    /* substituting. Grep this diff for `UPDATE provider_configs`: zero.    */
1578    /* ------------------------------------------------------------------ */
1579  
1580    /** PURE READ — no network call, no decryption, nothing user-initiated about
1581     *  it. Freshness is computed HERE (one home for the 24 h threshold); the
1582     *  renderer does no date arithmetic. */
1583    ipcMain.handle(IpcChannel.ModelList, (_event, payload): ModelListResponse => {
1584      const { provider_id } = modelListRequestSchema.parse(payload)
1585      const rows = storage.getModelCatalogForProvider(provider_id)
1586      const refreshedAt = storage.getCatalogRefreshedAt(provider_id)
1587      return modelListResponseSchema.parse({
1588        models: rows.map((r) => ({
1589          modelId: r.modelId,
1590          displayName: r.displayName,
1591          contextLength: r.contextLength,
1592          expiresAt: r.expiresAt,
1593          missingSince: r.missingSince
1594        })),
1595        refreshedAt,
1596        freshness: catalogFreshness(refreshedAt, new Date().toISOString()),
1597        // D85: read from a DIFFERENT table than `models` above, and that is the
1598        // point — the shortlist is not a projection of the catalog. An id here
1599        // with no row above is a model the user chose that the last refresh did
1600        // not return, which is a fact worth keeping rather than one to filter out.
1601        shortlist: storage.getModelShortlistForProvider(provider_id).map((r) => r.modelId)
1602      })
1603    })
1604  
1605    /**
1606     * D85: the shortlist write. ⚠ THE CHEAPEST HANDLER IN THIS FILE, AND IT MUST
1607     * STAY THAT WAY. It touches one local table. It makes no network call, reads
1608     * no credential, and calls nothing in `modelCatalog.ts` — a "helpfully"
1609     * refresh-then-shortlist convenience here would send the user's key on a
1610     * click that asked for nothing of the sort, which is the exact shape
1611     * `model:refresh`'s one-caller rule exists to prevent.
1612     *
1613     * ⚠ AND IT DOES NOT VALIDATE THE ID AGAINST THE CATALOG. See v12: a shortlist
1614     * constrained to ids a refresh happened to return would make the catalog
1615     * authoritative by construction, against D48/D56.
1616     */
1617    ipcMain.handle(IpcChannel.ModelShortlistSet, (_event, payload): ModelShortlistSetResponse => {
1618      const req = modelShortlistSetRequestSchema.parse(payload)
1619      if (!storage.getProviderConfigById(req.provider_id)) {
1620        return modelShortlistSetResponseSchema.parse({
1621          ok: false,
1622          reason: 'That provider no longer exists.'
1623        })
1624      }
1625      storage.setModelShortlisted(
1626        req.provider_id,
1627        req.model_id,
1628        req.shortlisted,
1629        new Date().toISOString()
1630      )
1631      // The list AFTER the write, so the renderer never renders its own guess.
1632      return modelShortlistSetResponseSchema.parse({
1633        ok: true,
1634        shortlist: storage.getModelShortlistForProvider(req.provider_id).map((r) => r.modelId)
1635      })
1636    })
1637  
1638    /**
1639     * ONE live GET <base_url>/models. USER-INITIATED ONLY — this handler has
1640     * exactly one caller, the Refresh button, and nothing in main calls it at
1641     * boot, at launch, on a timer, on settings-open, or on profile creation.
1642     *
1643     * The body is a call into modelCatalog.ts plus storage.applyCatalogDiff. It
1644     * CONTAINS NO POLICY, and in particular no write to provider_configs — not
1645     * even a "helpful" clear of a model that just went missing, which is the
1646     * exact convenience this whole task exists to refuse.
1647     *
1648     * ⚠ A success does NOT call markCredentialVerified. This endpoint answers
1649     * 200 with no credential at all, so a 200 is not evidence of authentication
1650     * and must not be dressed up as one (Task 3a-4 Goal §3).
1651     */
1652    ipcMain.handle(IpcChannel.ModelRefresh, async (_event, payload): Promise<ModelRefreshResponse> => {
1653      const req = modelRefreshRequestSchema.parse(payload)
1654      const provider = storage.getProviderConfigById(req.provider_id)
1655      if (!provider) {
1656        return modelRefreshResponseSchema.parse({
1657          ok: false,
1658          reason: 'That provider no longer exists.'
1659        })
1660      }
1661      // A named-but-missing profile is a refusal, never a silent downgrade to
1662      // the unauthenticated path: the user asked for that credential.
1663      let profile: CredentialProfileRow | null = null
1664      if (req.credential_id !== null) {
1665        profile = storage.getCredentialProfileById(req.credential_id)
1666        if (!profile) {
1667          return modelRefreshResponseSchema.parse({
1668            ok: false,
1669            reason: 'That credential profile no longer exists.'
1670          })
1671        }
1672        if (profile.providerId !== provider.id) {
1673          return modelRefreshResponseSchema.parse({
1674            ok: false,
1675            // Scrubbed, like every message probeFailure emits: the label and the
1676            // provider name are user-authored free text, so a user who pasted a
1677            // key into one must not have it echoed back into the DOM.
1678            reason: scrubSecrets(
1679              `Credential profile '${profile.label}' does not belong to provider '${provider.name}'.`
1680            )
1681          })
1682        }
1683      }
1684  
1685      const result = await refreshProviderModels({ provider, profile, vault })
1686      if (!result.ok) {
1687        return modelRefreshResponseSchema.parse({ ok: false, reason: result.reason })
1688      }
1689  
1690      const nowIso = new Date().toISOString()
1691      const existing = storage.getModelCatalogForProvider(provider.id)
1692      const diff = computeCatalogDiff(existing, result.models, nowIso, result.droppedCount)
1693      storage.applyCatalogDiff(provider.id, diff)
1694      // droppedCount is REPORTED, never silently swallowed — a provider that
1695      // suddenly fails validation on part of its list is a finding. Counts only;
1696      // no ids, no provider text.
1697      logger.info(
1698        `[models] refresh ${provider.name}: ${diff.addedCount} added · ${diff.updatedCount} updated · ${diff.markMissing.length} newly missing · ${diff.droppedCount} dropped · authenticated=${profile !== null}`
1699      )
1700      return modelRefreshResponseSchema.parse({
1701        ok: true,
1702        added: diff.addedCount,
1703        updated: diff.updatedCount,
1704        missing: diff.markMissing.length,
1705        dropped: diff.droppedCount,
1706        refreshedAt: nowIso
1707      })
1708    })
1709  
1710    /* ------------------------------------------------------------------ */
1711    /* Task 3a-5 / D43: launch profiles                                     */
1712    /* ------------------------------------------------------------------ */
1713  
1714    ipcMain.handle(IpcChannel.LaunchProfileList, (): LaunchProfileListResponse => {
1715      return launchProfileListResponseSchema.parse({ profiles: listLaunchProfileWire() })
1716    })
1717  
1718    ipcMain.handle(IpcChannel.LaunchProfileCreate, (_event, payload): LaunchProfileCreateResponse => {
1719      const req = launchProfileCreateRequestSchema.parse(payload)
1720      const provider = req.provider_id ? storage.getProviderConfigById(req.provider_id) : null
1721      const shape = validateProfileShape(
1722        {
1723          label: req.label,
1724          agent: req.agent,
1725          providerId: req.provider_id,
1726          credentialProfileId: req.credential_profile_id,
1727          model: req.model,
1728          effort: req.effort,
1729          permissionMode: req.permission_mode,
1730          workspaceMode: req.workspace_mode,
1731          envJson: req.env_json
1732        },
1733        provider,
1734        containsSecret
1735      )
1736      if (!shape.ok) {
1737        return launchProfileCreateResponseSchema.parse({ ok: false, reason: shape.reason })
1738      }
1739      // Checked HERE so the refusal is an AUTHORED sentence. The UNIQUE(label)
1740      // constraint stays as a backstop; it is never the thing the user reads.
1741      if (storage.getLaunchProfileByLabel(req.label.trim())) {
1742        return launchProfileCreateResponseSchema.parse({
1743          ok: false,
1744          reason: `A launch profile named '${req.label.trim()}' already exists.`
1745        })
1746      }
1747      // A credential must belong to the route it is being saved against — main
1748      // never trusts the renderer's pairing.
1749      if (req.credential_profile_id) {
1750        const cred = storage.getCredentialProfileById(req.credential_profile_id)
1751        if (!cred) {
1752          return launchProfileCreateResponseSchema.parse({
1753            ok: false,
1754            reason: 'That credential profile no longer exists.'
1755          })
1756        }
1757        if (cred.providerId !== req.provider_id) {
1758          return launchProfileCreateResponseSchema.parse({
1759            ok: false,
1760            reason: scrubSecrets(`Credential '${cred.label}' does not belong to that route.`)
1761          })
1762        }
1763      }
1764      const now = new Date().toISOString()
1765      const row = storage.createLaunchProfile({
1766        id: randomUUID(),
1767        label: req.label.trim(),
1768        agent: req.agent,
1769        providerId: req.provider_id,
1770        credentialProfileId: req.credential_profile_id,
1771        model: req.model,
1772        effort: req.effort,
1773        permissionMode: req.permission_mode,
1774        workspaceMode: req.workspace_mode,
1775        envJson: req.env_json,
1776        createdAt: now,
1777        updatedAt: now
1778      })
1779      // Ids and counts only — a label is user-authored free text, so it is
1780      // scrubbed like every other outbound string.
1781      logger.info(`[launch-profile] created ${row.id} (agent ${row.agent})`)
1782      return launchProfileCreateResponseSchema.parse({ ok: true, profile: toWire(row) })
1783    })
1784  
1785    ipcMain.handle(IpcChannel.LaunchProfileUpdate, (_event, payload): LaunchProfileUpdateResponse => {
1786      const req = launchProfileUpdateRequestSchema.parse(payload)
1787      const existing = storage.getLaunchProfileById(req.id)
1788      if (!existing) {
1789        return launchProfileUpdateResponseSchema.parse({
1790          ok: false,
1791          reason: 'That launch profile no longer exists.'
1792        })
1793      }
1794      // Patch semantics: absent = unchanged, null = clear, a value = set. The
1795      // MERGED shape is validated, never the patch alone.
1796      const merged = {
1797        label: req.label ?? existing.label,
1798        agent: existing.agent,
1799        providerId: existing.providerId,
1800        credentialProfileId:
1801          req.credential_profile_id === undefined
1802            ? existing.credentialProfileId
1803            : req.credential_profile_id,
1804        model: req.model === undefined ? existing.model : req.model,
1805        effort: req.effort === undefined ? existing.effort : req.effort,
1806        permissionMode:
1807          req.permission_mode === undefined ? existing.permissionMode : req.permission_mode,
1808        workspaceMode: req.workspace_mode ?? existing.workspaceMode,
1809        envJson: req.env_json === undefined ? existing.envJson : req.env_json
1810      }
1811      const provider = merged.providerId ? storage.getProviderConfigById(merged.providerId) : null
1812      const shape = validateProfileShape(merged, provider, containsSecret)
1813      if (!shape.ok) {
1814        return launchProfileUpdateResponseSchema.parse({ ok: false, reason: shape.reason })
1815      }
1816      if (req.label !== undefined) {
1817        const clash = storage.getLaunchProfileByLabel(req.label.trim())
1818        if (clash && clash.id !== req.id) {
1819          return launchProfileUpdateResponseSchema.parse({
1820            ok: false,
1821            reason: `A launch profile named '${req.label.trim()}' already exists.`
1822          })
1823        }
1824      }
1825      const updated = storage.updateLaunchProfile(req.id, {
1826        label: merged.label.trim(),
1827        credentialProfileId: merged.credentialProfileId,
1828        model: merged.model,
1829        effort: merged.effort,
1830        permissionMode: merged.permissionMode,
1831        workspaceMode: merged.workspaceMode,
1832        envJson: merged.envJson,
1833        updatedAt: new Date().toISOString()
1834      })
1835      if (!updated) {
1836        return launchProfileUpdateResponseSchema.parse({
1837          ok: false,
1838          reason: 'That launch profile no longer exists.'
1839        })
1840      }
1841      // ⚠ A RENAME HAS NO DOWNSTREAM CONSEQUENCE (D43). Nothing else is touched:
1842      // sessions.launch_profile_id and last_launch_profile:<projectId> both store
1843      // the IMMUTABLE ID, so they keep pointing at this row without being
1844      // rewritten, and a live session is entirely unaffected.
1845      return launchProfileUpdateResponseSchema.parse({ ok: true, profile: toWire(updated) })
1846    })
1847  
1848    ipcMain.handle(IpcChannel.LaunchProfileDelete, (_event, payload): LaunchProfileDeleteResponse => {
1849      const { id } = launchProfileDeleteRequestSchema.parse(payload)
1850      // ⚠ NO COUNT-AND-REFUSE HERE, deliberately, and this is the asymmetry the
1851      // FK design buys: sessions hold a SOFT pointer with no REFERENCES clause,
1852      // so deleting a profile cannot throw for a session that used it, and the
1853      // now-dangling pointer is absorbed by the FAIL-SAFE predicate — such a
1854      // session reads as credentialed and is healed rather than relaunched
1855      // keyless. A guard here would block a delete for a reason the user cannot
1856      // act on.
1857      storage.deleteLaunchProfile(id)
1858      logger.info(`[launch-profile] deleted ${id}`)
1859      return launchProfileDeleteResponseSchema.parse({ ok: true })
1860    })
1861  
1862    /* ------------------------------------------------------------------ */
1863    /* Task 3b-2 / D62: council members                                     */
1864    /*                                                                      */
1865    /* ⚠ NOTHING HERE ORCHESTRATES ANYTHING, MAKES AN API CALL, OR SPENDS A */
1866    /* CENT. These four channels configure WHO the council is; 3b-3 is what  */
1867    /* runs it. There is deliberately no "test this member" button — it      */
1868    /* would be a live billable call, and D57 is the standing warning about  */
1869    /* tests that cannot fail.                                              */
1870    /*                                                                      */
1871    /* ⚠ NO `provider_id` CROSSES THIS BOUNDARY IN EITHER DIRECTION. A       */
1872    /* member names a ROUTE BY NAMING A CREDENTIAL (D48/D56); the route is   */
1873    /* derived through `credential_profiles.provider_id`, which is the only  */
1874    /* home it has.                                                          */
1875    /* ------------------------------------------------------------------ */
1876  
1877    /** PURE READ — decrypts nothing, calls nothing, spends nothing. */
1878    ipcMain.handle(IpcChannel.CouncilMemberList, (): CouncilMemberListResponse => {
1879      return councilMemberListResponseSchema.parse({ members: listCouncilMemberWire() })
1880    })
1881  
1882    ipcMain.handle(IpcChannel.CouncilMemberCreate, (_event, payload): CouncilMemberCreateResponse => {
1883      const req = councilMemberCreateRequestSchema.parse(payload)
1884      const { credential, provider } = councilRouteFor(req.credentialProfileId)
1885      // Every OTHER member's label — on create that is all of them. The
1886      // UNIQUE(label) constraint stays a BACKSTOP; it is never what a user reads.
1887      const existingLabels = storage.listCouncilMembers().map((m) => m.label)
1888      const shape = validateMemberShape(
1889        {
1890          label: req.label,
1891          credentialProfileId: req.credentialProfileId,
1892          model: req.model,
1893          role: req.role,
1894          paramsJson: req.paramsJson
1895        },
1896        existingLabels,
1897        credential,
1898        provider,
1899        containsSecret
1900      )
1901      if (!shape.ok) {
1902        return councilMemberCreateResponseSchema.parse({ ok: false, reason: shape.reason })
1903      }
1904      const now = new Date().toISOString()
1905      const row = storage.createCouncilMember({
1906        id: randomUUID(),
1907        label: req.label.trim(),
1908        credentialProfileId: req.credentialProfileId,
1909        // ⚠ WRITTEN EXACTLY AS SENT. A NULL model STAYS NULL — the route's
1910        // default is NEVER copied in here (D56). That back-write is the second
1911        // home D48 exists to prevent, and it is one line away at all times.
1912        model: req.model,
1913        role: req.role,
1914        paramsJson: req.paramsJson,
1915        createdAt: now,
1916        updatedAt: now
1917      })
1918      // Ids and counts only — a label is user-authored free text, so it is
1919      // scrubbed like every other outbound string.
1920      logger.info(`[council-member] created ${row.id} (role ${row.role})`)
1921      return councilMemberCreateResponseSchema.parse({ ok: true, member: toCouncilMemberWire(row) })
1922    })
1923  
1924    ipcMain.handle(IpcChannel.CouncilMemberUpdate, (_event, payload): CouncilMemberUpdateResponse => {
1925      const req = councilMemberUpdateRequestSchema.parse(payload)
1926      const existing = storage.getCouncilMemberById(req.id)
1927      if (!existing) {
1928        return councilMemberUpdateResponseSchema.parse({
1929          ok: false,
1930          reason: 'That council member no longer exists.'
1931        })
1932      }
1933      // Patch semantics: absent = unchanged, null = clear, a value = set. The
1934      // MERGED shape is validated, never the patch alone.
1935      const merged = {
1936        label: req.label ?? existing.label,
1937        credentialProfileId: req.credentialProfileId ?? existing.credentialProfileId,
1938        model: req.model === undefined ? existing.model : req.model,
1939        role: req.role ?? existing.role,
1940        paramsJson: req.paramsJson === undefined ? existing.paramsJson : req.paramsJson
1941      }
1942      const { credential, provider } = councilRouteFor(merged.credentialProfileId)
1943      // ⚠ THIS MEMBER'S OWN LABEL IS EXCLUDED. A rename must be able to keep a
1944      // name this row already holds, and re-saving without a rename must not
1945      // refuse itself (D43: the label is freely renameable).
1946      const existingLabels = storage
1947        .listCouncilMembers()
1948        .filter((m) => m.id !== req.id)
1949        .map((m) => m.label)
1950      const shape = validateMemberShape(merged, existingLabels, credential, provider, containsSecret)
1951      if (!shape.ok) {
1952        return councilMemberUpdateResponseSchema.parse({ ok: false, reason: shape.reason })
1953      }
1954      const updated = storage.updateCouncilMember(req.id, {
1955        label: merged.label.trim(),
1956        credentialProfileId: merged.credentialProfileId,
1957        model: merged.model,
1958        role: merged.role,
1959        paramsJson: merged.paramsJson,
1960        updatedAt: new Date().toISOString()
1961      })
1962      if (!updated) {
1963        return councilMemberUpdateResponseSchema.parse({
1964          ok: false,
1965          reason: 'That council member no longer exists.'
1966        })
1967      }
1968      // ⚠ A RENAME HAS NO DOWNSTREAM CONSEQUENCE (D43). Nothing else is touched,
1969      // and nothing else NEEDS to be: `council_messages.member_id` stores the
1970      // IMMUTABLE ID, so every transcript keeps pointing at this row without
1971      // being rewritten. If this ever grows a "fix up the references" step, the
1972      // id-vs-label rule has been broken somewhere upstream.
1973      return councilMemberUpdateResponseSchema.parse({
1974        ok: true,
1975        member: toCouncilMemberWire(updated)
1976      })
1977    })
1978  
1979    ipcMain.handle(IpcChannel.CouncilMemberDelete, (_event, payload): CouncilMemberDeleteResponse => {
1980      const { id } = councilMemberDeleteRequestSchema.parse(payload)
1981      // ⚠ NO COUNT-AND-REFUSE HERE, deliberately, and it is the same asymmetry
1982      // the FK design buys for launch profiles above: `council_runs` and
1983      // `council_messages` hold SOFT pointers with no REFERENCES clause (D62), so
1984      // deleting a member cannot throw for a run it joined, and a transcript
1985      // stays true once the member that spoke it is gone. A guard here would
1986      // block a delete for a reason the user cannot act on — and a FK here would
1987      // make deleting a member throw for EVERY run it ever joined.
1988      storage.deleteCouncilMember(id)
1989      logger.info(`[council-member] deleted ${id}`)
1990      return councilMemberDeleteResponseSchema.parse({ ok: true })
1991    })
1992  
1993    /**
1994     * Task 3a-5 / D49 + D53: one-click relaunch of a session that was healed to
1995     * `exited` because it held a credential.
1996     *
1997     * ⚠⚠ THE INVARIANT THIS HANDLER EXISTS TO PRESERVE.
1998     *
1999     * Restore stays decision (b), and there is NO UNATTENDED RESOLUTION OF A
2000     * LAUNCH CREDENTIAL. Option (a) — re-resolving credentials inside restore() —
2001     * was DECLINED because D33 never sanctioned decrypting a launch credential
2002     * with no user present, and this task does not reintroduce it by the side
2003     * door. The ONLY thing added is this handler, which decrypts BECAUSE A HUMAN
2004     * CLICKED SOMETHING.
2005     *
2006     * That distance is the entire security argument, and it is ONE CARELESS
2007     * `await` WIDE: if any part of this logic is ever factored into a helper that
2008     * restore() also calls, the invariant is gone and NOTHING WILL FAIL TO
2009     * COMPILE. `SessionManager` contains zero references to the vault; keep it
2010     * that way.
2011     *
2012     * ⚠ On the call-site census: after this task `vault.decryptForLaunch` has
2013     * FIVE call sites, not three. Four are INFERENCE-credential paths and every
2014     * one of them is user-initiated — resolveCredential (launch), credential:test
2015     * (Test key), modelCatalog (Refresh), and this handler. The fifth is 3a-3's
2016     * MANAGEMENT-key thunk in index.ts, which does run at boot; that is a
2017     * different credential class that cannot do inference, is refused by
2018     * resolveCredential before decryption, and never reaches a child PTY. The
2019     * invariant is about the launch class. See _verify/3a-5/INVARIANT.md.
2020     */
2021    ipcMain.handle(IpcChannel.SessionRelaunch, async (_event, payload): Promise<RelaunchResponse> => {
2022      const { sessionId } = relaunchRequestSchema.parse(payload)
2023      const row = storage.getSessionById(sessionId)
2024      if (!row) {
2025        return relaunchResponseSchema.parse({ ok: false, reason: `Unknown sessionId: ${sessionId}` })
2026      }
2027      if (sessions.isRunning(sessionId)) {
2028        return relaunchResponseSchema.parse({
2029          ok: false,
2030          reason: 'Session is still running — kill it first'
2031        })
2032      }
2033      if (!fs.existsSync(row.cwd)) {
2034        return relaunchResponseSchema.parse({
2035          ok: false,
2036          reason: `Working directory not found: ${row.cwd}`
2037        })
2038      }
2039      if (!isAgentKind(row.agent)) {
2040        return relaunchResponseSchema.parse({
2041          ok: false,
2042          reason: `Unknown agent '${row.agent}' — this session cannot be relaunched.`
2043        })
2044      }
2045      // The LEGACY population and every bare-credential session land HERE, and
2046      // correctly: the retired settings list recorded ids only, so there is
2047      // nothing to resolve, and the honest answer is the one the healed title
2048      // already gives. Nothing special-cases the sentinel — it is simply a
2049      // pointer that does not resolve.
2050      const profile = row.launchProfileId ? storage.getLaunchProfileById(row.launchProfileId) : null
2051      if (!profile) {
2052        return relaunchResponseSchema.parse({
2053          ok: false,
2054          reason:
2055            'This session has no saved launch profile — start a new one from the launch dialog.'
2056        })
2057      }
2058      const resolution = resolveLaunchProfile(
2059        profile,
2060        profile.providerId ? storage.getProviderConfigById(profile.providerId) : null,
2061        profile.credentialProfileId
2062          ? storage.getCredentialProfileById(profile.credentialProfileId)
2063          : null
2064      )
2065      if (!resolution.ok) {
2066        return relaunchResponseSchema.parse({ ok: false, reason: resolution.reason })
2067      }
2068      const effortOpt: Pick<LaunchOptions, 'effort'> = resolution.plan.effort
2069        ? { effort: resolution.plan.effort }
2070        : {}
2071      const envOpt: Pick<LaunchOptions, 'envAdditions'> =
2072        Object.keys(resolution.plan.envAdditions).length > 0
2073          ? { envAdditions: resolution.plan.envAdditions }
2074          : {}
2075      let opts: LaunchOptions = { ...effortOpt, ...envOpt }
2076      if (resolution.plan.credentialProfileId) {
2077        // REUSE, do not fork: exactly one function in main resolves a launch
2078        // credential, so D33 clause 8's refusals have one place to live. A row
2079        // carrying unavailable_since is refused by resolveLaunchProfile ABOVE,
2080        // by label, WITHOUT re-attempting decryption.
2081        const resolved = await resolveCredential(resolution.plan.credentialProfileId, row.agent)
2082        if (!resolved.ok) return relaunchResponseSchema.parse({ ok: false, reason: resolved.reason })
2083        opts = {
2084          ...effortOpt,
2085          ...envOpt,
2086          secrets: [resolved.credential.value],
2087          credential: resolved.credential,
2088          ...(resolved.route ? { route: resolved.route } : {})
2089        }
2090      }
2091      try {
2092        // Same row id, the session:restart shape: no row creation, and 'running'
2093        // written ONLY AFTER the spawn succeeds.
2094        const snap = sessions.launch(row.agent, row.cwd, row.id, opts)
2095        storage.updateSessionStatus(sessionId, 'running', null)
2096        // ⚠ The healed title is NOT cleared. If the agent emits its own OSC title
2097        // it will replace it (D18's mechanism, already running); clearing it here
2098        // would be main inventing a title, which nothing else in the app does.
2099        const wt = row.worktreeId ? storage.getWorktreeById(row.worktreeId) : null
2100        return relaunchResponseSchema.parse({
2101          ...snap,
2102          title: row.title,
2103          branch: wt?.branch ?? null,
2104          worktreeId: wt?.id ?? null
2105        })
2106      } catch (err) {
2107        return relaunchResponseSchema.parse({
2108          ok: false,
2109          reason: scrubSecrets(err instanceof Error ? err.message : String(err))
2110        })
2111      }
2112    })
2113  
2114    /* ------------------------------------------------------------------ */
2115    /* Task 3b-3: the council run                                          */
2116    /* ------------------------------------------------------------------ */
2117  
2118    /**
2119     * ⚠ THE THIRD PATH A STORED INFERENCE CREDENTIAL TRAVELS, and it inherits
2120     * D58's terms whole. Numbered so the count stays auditable:
2121     *   1. credential:test  (Task 3-6, D33 resolution d)
2122     *   2. model:refresh    (Task 3a-4)
2123     *   3. council:start    (this)
2124     *
2125     * ⚠ IT IS THE THIRD AND NOT THE FOURTH BECAUSE `api:probe` WAS DELETED IN
2126     * THIS COMMIT. 3b-1 shipped it labelled *"a DELIBERATELY TEMPORARY proof
2127     * surface … 3b-3 adopts this or deletes it"*, and the honest answer is
2128     * delete: the transport now has a real consumer with real tests and a live
2129     * drive, which is strictly better proof than a probe with no product behind
2130     * it. Adopting it would have meant keeping a permanently-reachable billable
2131     * path that no user interface can reach — the exact shape D58 exists to stop
2132     * accumulating.
2133     *
2134     * ⚠ AND D60 IS THE INVARIANT, NOT THE COUNT: no code path reachable WITHOUT A
2135     * USER GESTURE may resolve a LAUNCH credential. `council:start` is reachable
2136     * only by invoke, and a council run writes no `sessions` row (D63 Q2), so the
2137     * restore engine structurally cannot reach it either — the guarantee holds by
2138     * construction rather than by a guard.
2139     *
2140     * ⚠ THE CREDENTIAL IS DECRYPTED AND THROWN AWAY. `resolveCredential` is
2141     * REUSED for its five ordered refusals and for the effective ROUTE; the key
2142     * that actually goes into the `Authorization` header is the run's MINTED one,
2143     * because that is what gives the run a single bounded spend surface (D64(2)).
2144     * Decrypting a key we never send is a real cost, paid deliberately: the
2145     * alternative is a second, shorter refusal ladder that drifts from the first.
2146     */
2147    const resolveMemberRoute = async (
2148      credentialProfileId: string
2149    ): Promise<{ ok: true; route: MemberRoute | null } | { ok: false; reason: string }> => {
2150      // ⚠ D84 — THIS IS WHAT USED TO BE BLOCKER A, AND THE FIX IS A DELETION.
2151      // The council has no agent CLI, so it now says so: `null`. It previously
2152      // parsed an `AgentKind` out of `provider.adapterType` and passed it back
2153      // in — the comment here said in as many words that this made
2154      // `resolveCredential`'s ownership check "a no-op HERE", which is true and
2155      // is the point: the parse existed ONLY to manufacture an argument for a
2156      // check it then defeated by construction. Its only real effect was the
2157      // REFUSAL when the parse failed, which fired on precisely the providers
2158      // that name a route rather than a harness — a configuration Settings
2159      // accepted and a council run then rejected at spend time.
2160      //
2161      // Every other refusal in `resolveCredential` still runs, in the same order:
2162      // missing profile, known-bad row, missing provider, MANAGEMENT class,
2163      // no env var name, decrypt failure.
2164      //
2165      // ⚠ THE TWO PRE-LOOKUPS THAT USED TO STAND HERE ARE GONE WITH THE PARSE
2166      // THEY FED. They re-derived `profile` and `provider` only to reach
2167      // `adapterType`, and re-emitted two refusals `resolveCredential` already
2168      // emits WORD FOR WORD. Keeping them would be exactly the "second, shorter
2169      // refusal ladder that drifts from the first" the note above warns against.
2170      const resolved = await resolveCredential(credentialProfileId, null)
2171      if (!resolved.ok) return { ok: false, reason: resolved.reason }
2172      // ⚠ THE PLAINTEXT DIES HERE. Only the route survives this function, and the
2173      // env var name on it is non-secret metadata.
2174      if (!resolved.route) return { ok: true, route: null }
2175      return {
2176        ok: true,
2177        route: { baseUrl: resolved.route.baseUrl, envVarName: resolved.credential.envVarName }
2178      }
2179    }
2180  
2181    const council = createCouncilService({
2182      storage,
2183      keys,
2184      hasManagementKey,
2185      resolveMemberRoute,
2186      // The broadcast, following `session:data` exactly: validated HERE in main
2187      // (the preload cannot run Zod under the page CSP) and fanned out to every
2188      // window. Its text already came through SessionOutput's scrubber.
2189      emitProgress: (event) => {
2190        const parsed = councilProgressEventSchema.parse(event)
2191        for (const win of BrowserWindow.getAllWindows()) {
2192          win.webContents.send(IpcChannel.CouncilProgress, parsed)
2193        }
2194      },
2195      gatewayBaseUrl: OPENROUTER_GATEWAY_BASE_URL
2196    })
2197  
2198    /**
2199     * The brief picker. `dialog.showOpenDialog` in MAIN — the `project:add`
2200     * precedent down to the structured cancel — filtered to `.md`.
2201     *
2202     * ⚠ IT IS NOT THE SECURITY BOUNDARY AND MUST NOT BE MISTAKEN FOR ONE. The
2203     * renderer can call `council:start` with any string it likes; what makes the
2204     * path safe is `councilService.validateBriefPath`, which runs on every start
2205     * regardless of where the path came from. This handler only saves the user
2206     * from typing one.
2207     */
2208    ipcMain.handle(IpcChannel.CouncilPickBrief, async (_event, payload): Promise<CouncilPickBriefResponse> => {
2209      councilPickBriefRequestSchema.parse(payload ?? {})
2210      const result = await dialog.showOpenDialog({
2211        title: 'Choose a council brief',
2212        properties: ['openFile'],
2213        filters: [{ name: 'Markdown', extensions: ['md'] }]
2214      })
2215      if (result.canceled || !result.filePaths[0]) {
2216        return councilPickBriefResponseSchema.parse({ cancelled: true })
2217      }
2218      return councilPickBriefResponseSchema.parse({ path: result.filePaths[0] })
2219    })
2220  
2221    ipcMain.handle(IpcChannel.CouncilStart, async (_event, payload): Promise<CouncilStartResponse> => {
2222      const req = councilStartRequestSchema.parse(payload)
2223      // ⚠ THE PATH GOES IN RAW AND THE SERVICE REFUSES IT. Nothing is checked
2224      // here: one boundary, in one place, that every caller crosses.
2225      const result = await council.start({ projectId: req.project_id, briefPath: req.brief_path })
2226      if (!result.ok) {
2227        return councilStartResponseSchema.parse({ ok: false, reason: result.reason })
2228      }
2229      return councilStartResponseSchema.parse({
2230        ok: true,
2231        run_id: result.runId,
2232        findings: result.findings,
2233        findings_path: result.findingsPath,
2234        findings_error: result.findingsError,
2235        // ⚠ D55: the cost never travels without its denominator, and the outbound
2236        // `.parse` is what enforces that rather than a convention.
2237        accounting: result.accounting,
2238        cost_usd: result.costUsd
2239      })
2240    })
2241  
2242    ipcMain.handle(IpcChannel.CouncilCancel, (_event, payload): CouncilCancelResponse => {
2243      const req = councilCancelRequestSchema.parse(payload)
2244      return councilCancelResponseSchema.parse({ cancelled: council.cancel(req.run_id) })
2245    })
2246  
2247    /**
2248     * D97 / Task 3e-4 — the transcript reader. **Validates, reads, bounds,
2249     * returns, and mutates nothing.**
2250     *
2251     * ⚠ IT CALLS THE READ FUNCTION THAT ALREADY EXISTS (`storage.ts:1819`) rather
2252     * than writing a second query over `council_messages`. That function shipped
2253     * in 3b-2 with zero callers and its ordering — round, then insertion — is the
2254     * shape the `council_messages_run` index was created for. A second read path
2255     * over one table is the two-homes hazard this codebase keeps ruling against.
2256     */
2257    ipcMain.handle(IpcChannel.CouncilTranscript, (_event, payload): CouncilTranscriptResponse => {
2258      const req = councilTranscriptRequestSchema.parse(payload)
2259      const rows = storage.getCouncilMessagesForRun(req.run_id)
2260      const turns: CouncilTranscriptTurn[] = []
2261      let chars = 0
2262      let truncated = false
2263      for (const row of rows) {
2264        const remaining = COUNCIL_TRANSCRIPT_CAP_CHARS - chars
2265        if (remaining <= 0) {
2266          truncated = true
2267          break
2268        }
2269        // The last turn admitted may be CUT rather than dropped, so a single
2270        // enormous turn still shows its beginning instead of the read returning
2271        // nothing at all. Either way `truncated` says so.
2272        const text = row.content.length <= remaining ? row.content : row.content.slice(0, remaining)
2273        if (text.length < row.content.length) truncated = true
2274        chars += text.length
2275        turns.push({
2276          member_id: row.memberId,
2277          phase: row.phase,
2278          round: row.round,
2279          text
2280        })
2281      }
2282      if (turns.length < rows.length) truncated = true
2283      // ⚠ D14: plain objects only. `better-sqlite3` rows already are, and the
2284      // literals above keep them that way — nothing reactive, nothing decorated.
2285      return councilTranscriptResponseSchema.parse({
2286        run_id: req.run_id,
2287        turns,
2288        total_turns: rows.length,
2289        truncated,
2290        chars,
2291        cap_chars: COUNCIL_TRANSCRIPT_CAP_CHARS
2292      })
2293    })
2294  
2295    ipcMain.handle(IpcChannel.SessionSetTitle, (_event, payload): void => {
2296      const { sessionId, title } = setTitleRequestSchema.parse(payload)
2297      // Titles are raw terminal output: strip controls, re-bound, and never
2298      // persist a blank — an empty post-sanitize result is a silent no-op.
2299      const clean = sanitizeTitle(title).slice(0, 120)
2300      if (clean.length === 0) return
2301      storage.updateSessionTitle(sessionId, clean)
2302      // Write cadence is the debounce's observable: ~1 line per settle, never
2303      // one per TUI redraw. Titles are terminal output, not secrets.
2304      logger.info(`[title] persisted ${sessionId}: ${JSON.stringify(clean)}`)
2305    })
2306  
2307    ipcMain.handle(IpcChannel.CliDetect, (_event, payload): Promise<CliDetectResponse> => {
2308      cliDetectRequestSchema.parse(payload ?? {})
2309      return detectClis()
2310    })
2311  
2312    // Task 3-3 (coordinator addition beyond D34(f)): the STATIC adapter
2313    // declarations — auth methods + capabilities, no probing, no installation
2314    // state (cli:detect owns that), no secret-adjacent field. Task 3-4's
2315    // provider form renders auth methods from this instead of hardcoding them.
2316    //
2317    // ⚠ D84: this channel now publishes the PROVIDER-TYPE vocabulary, which is
2318    // the agent registry PLUS the harness-less declaration — appended LAST so the
2319    // provider form's default (`settings.adapters[0]`) is unchanged. The two
2320    // sources stay structurally separate: `staticRegistry` is still exactly two
2321    // frozen `AgentAdapter`s, and `NO_HARNESS_DESCRIPTOR` is not one and is not
2322    // in it. `executionMode` is what tells them apart on the wire ('pty' vs
2323    // 'api'), which is why that field already existed with no producer for 'api'.
2324    ipcMain.handle(IpcChannel.AdapterList, (_event, payload): AdapterListResponse => {
2325      adapterListRequestSchema.parse(payload ?? {})
2326      return adapterListResponseSchema.parse([
2327        ...Object.values(staticRegistry).map((adapter) => ({
2328          id: adapter.id,
2329          displayName: adapter.displayName,
2330          executionMode: adapter.executionMode,
2331          authMethods: adapter.getAuthMethods(),
2332          capabilities: adapter.getCapabilities()
2333        })),
2334        NO_HARNESS_DESCRIPTOR
2335      ])
2336    })
2337  
2338    ipcMain.handle(IpcChannel.LayoutGet, (_event, payload): LayoutGetResponse => {
2339      const req = layoutGetRequestSchema.parse(payload)
2340      const p = requireProject(req.project_id)
2341      // Session data rides the layout:get response (no new channel). Outbound
2342      // parse keeps the boundary schema-checked in both directions. 2-2: the
2343      // branch label joins the rows here — resolved from the WORKTREES side
2344      // (worktrees.session_id, F18a) in a single pass over the project's
2345      // worktree rows, NOT per-row lookups via sessions.worktree_id.
2346      const branchBySession = new Map<string, string>()
2347      for (const w of storage.getWorktreesForProject(p.id)) {
2348        if (w.sessionId !== null) branchBySession.set(w.sessionId, w.branch)
2349      }
2350      // D37 (F25): tolerate unknown-agent rows at the PROJECTION, never the
2351      // schema. sessionInfoSchema.agent stays the two-value enum, so the
2352      // outbound parse below would reject the WHOLE aggregate over one row
2353      // whose agent column holds an unknown value — the project's load watcher
2354      // then took an uncaught rejection and rendered the empty state despite a
2355      // real layout. Filtering here drops such rows from the RESPONSE only:
2356      // the tree passes through untouched (the affected leaf renders
2357      // LayoutRenderer's leaf-without-row placeholder) and the DB row is left
2358      // alone (reconcile/restore own row state). Registry membership implies
2359      // enum membership today — staticRegistry is keyed by AgentKind.
2360      const knownAgentRows = storage.getSessionsForProject(p.id).filter((row) => {
2361        if (getAdapter(row.agent)) return true
2362        logger.warn(
2363          `[layout] layout:get dropping session row ${row.id}: unknown agent '${row.agent}'`
2364        )
2365        return false
2366      })
2367      return layoutGetResponseSchema.parse({
2368        layout: storage.getPaneLayout(p.id),
2369        sessions: knownAgentRows.map((row) => ({
2370          ...row,
2371          branch: branchBySession.get(row.id) ?? null
2372        }))
2373      })
2374    })
2375  
2376    ipcMain.handle(IpcChannel.LayoutSet, (_event, payload): void => {
2377      // layoutSetRequestSchema enforces shape + ratio bounds at the boundary;
2378      // savePaneLayout normalizes again on write (clamp + dedupe) — defense in
2379      // depth per council D9. A null tree means the last pane closed: DELETE the
2380      // row — its absence is the empty signal. Per project, as 1-4 established.
2381      const req = layoutSetRequestSchema.parse(payload)
2382      const p = requireProject(req.project_id)
2383      if (req.layout === null) {
2384        storage.clearPaneLayout(p.id)
2385        return
2386      }
2387      storage.savePaneLayout(p.id, req.layout)
2388    })
2389  
2390    ipcMain.handle(IpcChannel.ViewGet, (_event, payload): ViewState => {
2391      const req = viewGetRequestSchema.parse(payload)
2392      const p = requireProject(req.project_id)
2393      // D20: filmstrip is the DEFAULT, applied when no row exists — this is what
2394      // makes existing DBs open in the filmstrip on first post-1b boot. Outbound
2395      // parse keeps the boundary schema-checked (storage already collapses
2396      // corrupt rows to null, so the default covers them too).
2397      return viewStateSchema.parse(
2398        storage.getViewState(p.id) ?? { mode: 'filmstrip', focusedSessionId: null }
2399      )
2400    })
2401  
2402    ipcMain.handle(IpcChannel.ViewSet, (_event, payload): void => {
2403      const req = viewSetRequestSchema.parse(payload)
2404      const p = requireProject(req.project_id)
2405      // focusedSessionId is deliberately NOT FK-checked (F4): it legitimately
2406      // outlives its session; views resolve staleness by first-leaf fallback.
2407      storage.setViewState(p.id, req.state)
2408    })
2409  
2410    /* ---------------------------------------------------------------- */
2411    /* Task 3a-2: attention capture (spec §5.3). Modelled on the         */
2412    /* ViewGet/ViewSet pair above — parse in, requireProject, call,      */
2413    /* outbound .parse on the way back.                                  */
2414    /* ---------------------------------------------------------------- */
2415  
2416    ipcMain.handle(IpcChannel.AttentionReport, (_event, payload): void => {
2417      const req = attentionReportSchema.parse(payload)
2418      // sessionId is deliberately NOT FK-checked, exactly as view:set's
2419      // focusedSessionId is not (F4): a report can legitimately name a session
2420      // main has just seen exit, and a throw here would break the renderer's
2421      // fire-and-forget send. There is no read-back on this channel.
2422      attention.applyReport(req)
2423    })
2424  
2425    ipcMain.handle(IpcChannel.AttentionSummary, (_event, payload): AttentionSummary => {
2426      const req = attentionSummaryRequestSchema.parse(payload)
2427      const p = requireProject(req.project_id)
2428      // ⚠ THE OUTBOUND PARSE IS WHAT MAKES THE DENOMINATOR RULE STRUCTURAL rather
2429      // than aspirational — the same move D33 clause 3 used for key material. If
2430      // a future edit drops coveragePct or byClass from the returned object, this
2431      // handler THROWS rather than shipping a bare number that will be believed.
2432      return attentionSummaryResponseSchema.parse(attention.summary(p.id, req.from, req.to))
2433    })
2434  
2435    /* ---------------------------------------------------------------- */
2436    /* Task 3a-3: "% of spend attributed" (D42). Deliberately NOT        */
2437    /* project-scoped: a minted key's spend is an ACCOUNT fact, and the  */
2438    /* denominator (total gateway spend) has no project dimension at all */
2439    /* — scoping the numerator while the denominator stays global would  */
2440    /* produce a ratio of two different things.                          */
2441    /* ---------------------------------------------------------------- */
2442  
2443    ipcMain.handle(IpcChannel.AttributionSummary, async (_event, payload): Promise<AttributionSummary> => {
2444      const req = attributionSummaryRequestSchema.parse(payload)
2445      const summary = await attribution.summary(req.from, req.to)
2446      // ⚠ THE OUTBOUND PARSE IS WHAT MAKES D55 STRUCTURAL HERE, exactly as it
2447      // does on attention:summary. If a future edit drops a denominator —
2448      // gatewayTotalUsd, totalDispatches, subscriptionDispatches — or adds a
2449      // field capable of carrying key material, this handler THROWS rather than
2450      // shipping a bare percentage that will be believed, or a key that will not.
2451      return attributionSummaryResponseSchema.parse({
2452        from: req.from,
2453        to: req.to,
2454        spendPct: summary.spendPct,
2455        dispatchPct: summary.dispatchPct,
2456        attributedUsd: summary.attributedUsd,
2457        unattributedUsd: summary.unattributedUsd,
2458        gatewayTotalUsd: summary.gatewayTotalUsd,
2459        totalDispatches: summary.totalDispatches,
2460        attributedDispatches: summary.attributedDispatches,
2461        subscriptionDispatches: summary.subscriptionDispatches,
2462        tokensSourceBreakdown: summary.tokensSourceBreakdown,
2463        spendBasis: 'gateway-only',
2464        managementKeyConfigured: summary.managementKeyConfigured
2465      })
2466    })
2467  
2468    ipcMain.handle(IpcChannel.ProjectAdd, async (_event, payload): Promise<ProjectAddResponse> => {
2469      projectAddRequestSchema.parse(payload ?? {})
2470      // D3: the native picker runs in main; the renderer never enumerates
2471      // directories itself. Cancel is a structured no-op, not an error.
2472      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
2473      if (result.canceled || !result.filePaths[0]) {
2474        return projectAddResponseSchema.parse({ cancelled: true })
2475      }
2476      const project = storage.getOrCreateProject(result.filePaths[0])
2477      return projectAddResponseSchema.parse({ project: toWireProject(project) })
2478    })
2479  
2480    ipcMain.handle(IpcChannel.ProjectList, (_event): ProjectsList => {
2481      const activeId = storage.getActiveProjectId()
2482      // D80: `sessionCount` joins `active` as a list-only field, built explicitly
2483      // beside it rather than folded into toWireProject — that mapper's job is
2484      // the bare projects-row shape `project:add` also returns. ONE extra read
2485      // for the whole list, never one per project.
2486      const counts = storage.countSessionsByProject()
2487      return projectsListSchema.parse(
2488        storage.listProjects().map((p) => ({
2489          ...toWireProject(p),
2490          active: p.id === activeId,
2491          sessionCount: counts.get(p.id) ?? 0
2492        }))
2493      )
2494    })
2495  
2496    ipcMain.handle(IpcChannel.ProjectSelect, (_event, payload): void => {
2497      const req = projectSelectRequestSchema.parse(payload)
2498      const p = requireProject(req.project_id)
2499      storage.setActiveProjectId(p.id)
2500      BrowserWindow.getAllWindows()[0]?.setTitle(p.name)
2501      // Lazy restore (D16): relaunch this project's persisted 'running' rows
2502      // now — never before its first activation. restore() is idempotent within
2503      // a run (live-guarded, healed rows stay healed), so re-selects are cheap.
2504      void sessions.restore(p.id)
2505    })
2506  
2507    /**
2508     * The project settings screen's save. Name, colour and description in one
2509     * write — the screen edits them together, and three channels would let a
2510     * half-saved form leave the rail disagreeing with the row.
2511     *
2512     * ⚠ THE WINDOW TITLE IS RETITLED HERE, and only when the edited project is
2513     * the ACTIVE one. `project:select` is the only other place that sets the
2514     * title; without this, renaming the project you are looking at would leave
2515     * the titlebar showing the old name until the next time you switched away
2516     * and back.
2517     */
2518    ipcMain.handle(IpcChannel.ProjectUpdate, (_event, payload): ProjectUpdateResponse => {
2519      const req = projectUpdateRequestSchema.parse(payload)
2520      requireProject(req.project_id)
2521      // "" -> NULL, so an emptied description is stored as the SAME absence a
2522      // never-written one is. Two representations of "no description" would read
2523      // differently everywhere they are tested for.
2524      const description = req.description.trim() === '' ? null : req.description
2525      const updated = storage.updateProject(req.project_id, {
2526        name: req.name,
2527        color: req.color,
2528        description
2529      })
2530      if (!updated) throw new Error(`Unknown project_id: ${req.project_id}`)
2531      if (storage.getActiveProjectId() === updated.id) {
2532        BrowserWindow.getAllWindows()[0]?.setTitle(updated.name)
2533      }
2534      return projectUpdateResponseSchema.parse({ project: toWireProject(updated) })
2535    })
2536  
2537    ipcMain.handle(IpcChannel.SessionWrite, (_event, payload) => {
2538      const { sessionId, data } = writeRequestSchema.parse(payload)
2539      sessions.write(sessionId, data)
2540    })
2541  
2542    ipcMain.handle(IpcChannel.SessionResize, (_event, payload) => {
2543      const { sessionId, cols, rows } = resizeRequestSchema.parse(payload)
2544      sessions.resize(sessionId, cols, rows)
2545    })
2546  
2547    ipcMain.handle(IpcChannel.SessionKill, (_event, payload) => {
2548      const { sessionId } = killRequestSchema.parse(payload)
2549      sessions.kill(sessionId)
2550    })
2551  
2552    /* ═══ Task 3c-2 / D74 — window controls ═══════════════════════════════════
2553     *
2554     * The three handlers `frame: false` makes necessary. They live HERE, with the
2555     * other 48, because `registerIpc` is the one home for IPC registration and a
2556     * second registration site in `index.ts` is exactly the drift this codebase
2557     * keeps ruling against. Only the two window LISTENERS live in `index.ts`,
2558     * because those attach to the window instance beside the `resized`/`moved`
2559     * wiring.
2560     *
2561     * ⚠ They act on the window that ASKED — `fromWebContents(event.sender)` —
2562     * rather than on `getAllWindows()[0]`.
2563     *
2564     * ImplementationSpec-3c-2 §3 pointed at the `getAllWindows()` precedent, and
2565     * for the maximized-changed BROADCAST that is right: an event fans out to
2566     * every window. But a window control is not a broadcast, it is an imperative
2567     * on one window, and `[0]` is correct today only because exactly one window
2568     * exists. Phase 7's pop-out windows are the declared plan to change that, and
2569     * `[0]` would then close the main window when a pop-out's close button was
2570     * pressed — a defect that would look like a Phase 7 bug and be attributed
2571     * there. Asking the sender costs nothing and presumes nothing.
2572     *
2573     * A null sender is not an error path worth throwing over: the window was
2574     * destroyed between the click and the handler, and there is nothing to do.
2575     */
2576    ipcMain.handle(IpcChannel.WindowMinimize, (event) => {
2577      BrowserWindow.fromWebContents(event.sender)?.minimize()
2578    })
2579  
2580    ipcMain.handle(IpcChannel.WindowClose, (event) => {
2581      // close(), not destroy(): this is the normal quit path, so 'before-quit'
2582      // still runs and sessions tear down exactly as they did with a native frame.
2583      BrowserWindow.fromWebContents(event.sender)?.close()
2584    })
2585  
2586    ipcMain.handle(IpcChannel.WindowToggleMaximize, (event) => {
2587      const win = BrowserWindow.fromWebContents(event.sender)
2588      if (!win) return windowMaximizedSchema.parse({ maximized: false })
2589      if (win.isMaximized()) win.unmaximize()
2590      else win.maximize()
2591      // Read the state BACK from the window rather than assuming the toggle took:
2592      // the returned value is what settles the caller's icon.
2593      return windowMaximizedSchema.parse({ maximized: win.isMaximized() })
2594    })
2595  
2596    // Outbound events are validated here in main (the preload cannot run Zod
2597    // under the page CSP), so both directions of the boundary stay schema-checked.
2598    sessions.onData((sessionId, data) => {
2599      const event = sessionDataEventSchema.parse({ sessionId, data })
2600      for (const win of BrowserWindow.getAllWindows()) {
2601        win.webContents.send(IpcChannel.SessionData, event)
2602      }
2603    })
2604  
2605    sessions.onExit((sessionId, exitCode) => {
2606      const event = sessionExitEventSchema.parse({ sessionId, exitCode })
2607      for (const win of BrowserWindow.getAllWindows()) {
2608        win.webContents.send(IpcChannel.SessionExit, event)
2609      }
2610    })
2611  
2612    // 3a-3: the FIFTH independent onExit listener (event forward · D11 status
2613    // persist · 3a-1 recorder close · 3a-2 attention stop · this). Read the key's
2614    // usage, then revoke it, then enrich the row.
2615    //
2616    // ⚠ DELIBERATELY NOT FOLDED INTO ANY EXISTING LISTENER. exitListeners is a
2617    // Set and a throw inside one must not stop the exit event reaching the
2618    // renderer, the sessions table, 3a-1's row close, or 3a-2's clock. The async
2619    // body is fire-and-forget for the same reason — settleDispatch swallows its
2620    // own failures and an unhandled rejection here would be a telemetry bug that
2621    // reaches the user.
2622    sessions.onExit((sessionId) => {
2623      void attribution.settleDispatch(sessionId)
2624    })
2625  
2626    sessions.onRestored((sessionId) => {
2627      const event = sessionRestoredEventSchema.parse({ sessionId })
2628      for (const win of BrowserWindow.getAllWindows()) {
2629        win.webContents.send(IpcChannel.SessionRestored, event)
2630      }
2631    })
2632  
2633    return council
2634  }
2635  
```

### Exhibit 8 — `src/renderer/src/stores/council.ts` (lines 1–293, 11223 bytes)

```ts
  1  import { defineStore } from 'pinia'
  2  import type {
  3    CouncilAccounting,
  4    CouncilMemberWire,
  5    CouncilProgressEvent,
  6    CouncilTranscriptTurn
  7  } from '../../../shared/ipc'
  8  
  9  /**
 10   * Task 3b-4: the council run's renderer-side state.
 11   *
 12   * ⚠ IT OWNS NO TRANSPORT AND NO FILESYSTEM. There is no `fetch` here, no `fs`,
 13   * and no path arithmetic: the brief is chosen by a MAIN-side dialog, opened by
 14   * main, and the findings path is DERIVED in main from the validated brief path.
 15   * This store holds what came back and nothing it computed itself.
 16   *
 17   * ⚠ AND EVERY BYTE OF `messages` ARRIVED PRE-SCRUBBED. `council:progress` is fed
 18   * from main's `SessionOutput.onText` (`councilService.driveMember`), which is
 19   * the one ingest seam; there is deliberately no second channel here that could
 20   * carry a raw model stream.
 21   */
 22  
 23  /** One member's live text for one phase of one round, accumulated from deltas.
 24   *  Kept as a flat array in arrival order — the view renders the deliberation as
 25   *  it happened, and a per-member map would lose the ordering that makes a blind
 26   *  round legible. */
 27  export interface CouncilMessage {
 28    memberId: string | null
 29    phase: CouncilProgressEvent['phase']
 30    round: number
 31    text: string
 32  }
 33  
 34  interface CouncilStoreState {
 35    runId: string | null
 36    /** As MAIN normalized it, echoed back for display only. */
 37    briefPath: string | null
 38    phase: CouncilProgressEvent['phase'] | null
 39    round: number | null
 40    members: CouncilMemberWire[]
 41    messages: CouncilMessage[]
 42    findings: string | null
 43    findingsPath: string | null
 44    /** The reason beside a null path, so an absent file is never an absent
 45     *  explanation. */
 46    findingsError: string | null
 47    accounting: CouncilAccounting | null
 48    costUsd: number | null
 49    error: string | null
 50    running: boolean
 51    /** Store-level supersede token — `view.ts::loadFor`'s idiom. A component-level
 52     *  token cannot cancel an await already running INSIDE the store. */
 53    loadSeq: number
 54  
 55    /* ---- the STORED transcript (D97 / Task 3e-4) --------------------------
 56     *
 57     * ⚠ FOUR FIELDS OF ITS OWN, AND THE SEPARATION FROM `messages` IS THE WHOLE
 58     * DESIGN (ImplementationSpec-3e-4 §3). `messages` is fed by the live
 59     * `council:progress` broadcast through `ingest()`, whose block identity is
 60     * keyed on (member, phase, round) — F37's fix, after a live run rendered 291
 61     * fragments where 8 turns belonged. Loading historical rows into it would put
 62     * finished text through a delta-append path it is not, and would collide with
 63     * a run in flight. These rows arrive whole; they never need appending; they
 64     * live here. */
 65    /** null means "not loaded", which is different from "loaded and empty". */
 66    transcript: CouncilTranscriptTurn[] | null
 67    /** Rows stored for the run — `transcript.length`'s denominator (D55). */
 68    transcriptTotal: number
 69    /** The read hit its cap. Rendered, never swallowed. */
 70    transcriptTruncated: boolean
 71    transcriptError: string | null
 72    transcriptLoading: boolean
 73    /** ⚠ NOT `loadSeq`. Sharing one token would let a roster reload silently
 74     *  cancel a transcript read, which is a bug nobody would look for. */
 75    transcriptSeq: number
 76  }
 77  
 78  /** ⚠ NOT IN STATE. The unsubscribe handle is a function; Pinia state is
 79   *  devtools-serialized and structured-cloned, and a function there is a trap
 80   *  waiting for the first person who snapshots the store. */
 81  let offProgress: (() => void) | null = null
 82  
 83  export const useCouncilStore = defineStore('council', {
 84    state: (): CouncilStoreState => ({
 85      runId: null,
 86      briefPath: null,
 87      phase: null,
 88      round: null,
 89      members: [],
 90      messages: [],
 91      findings: null,
 92      findingsPath: null,
 93      findingsError: null,
 94      accounting: null,
 95      costUsd: null,
 96      error: null,
 97      running: false,
 98      loadSeq: 0,
 99      transcript: null,
100      transcriptTotal: 0,
101      transcriptTruncated: false,
102      transcriptError: null,
103      transcriptLoading: false,
104      transcriptSeq: 0
105    }),
106  
107    getters: {
108      /** The roster the run will actually convene, in main's own resolution. */
109      arbiters: (state): CouncilMemberWire[] => state.members.filter((m) => m.role === 'arbiter'),
110      deliberators: (state): CouncilMemberWire[] => state.members.filter((m) => m.role === 'member'),
111      /** ⚠ A PARTIAL COUNCIL MUST READ AS PARTIAL (spec §4.2). Surfaced beside the
112       *  roster rather than inferred from a count the user has to do themselves. */
113      unavailable: (state): CouncilMemberWire[] => state.members.filter((m) => !m.available)
114    },
115  
116    actions: {
117      /** The saved roster, from main. Superseded loads are dropped rather than
118       *  applied late. */
119      async loadMembers(): Promise<void> {
120        const seq = ++this.loadSeq
121        try {
122          const res = await window.chorus.listCouncilMembers()
123          if (seq !== this.loadSeq) return // superseded by a newer load
124          this.members = res.members
125        } catch (err) {
126          if (seq !== this.loadSeq) return
127          this.error = err instanceof Error ? err.message : 'The council members could not be loaded.'
128        }
129      },
130  
131      /**
132       * Subscribe to the scrubbed progress broadcast.
133       *
134       * ⚠ IDEMPOTENT, AND THE PREVIOUS HANDLE IS RELEASED FIRST. The F13 leak
135       * (`de98679`) was a listener registered after an `await` in `onMounted`
136       * outliving its component; a store-level subscription has the same failure
137       * with a longer life, so there is exactly one live at a time and
138       * `unsubscribe` is called on unmount.
139       */
140      subscribe(): void {
141        this.unsubscribe()
142        offProgress = window.chorus.onCouncilProgress((event) => {
143          // ⚠ THE FIRST DELTA IS HOW THIS SIDE LEARNS THE RUN ID, and without it
144          // Cancel would be unreachable: `council:start` is ONE invoke that does
145          // not resolve until the whole deliberation is over, so the id on its
146          // response arrives far too late to cancel anything. Adopted only while
147          // a run of ours is in flight, so a stray delta from another window's
148          // run cannot bind this store to it.
149          if (this.runId === null) {
150            if (!this.running) return
151            this.runId = event.runId
152          } else if (event.runId !== this.runId) {
153            return
154          }
155          this.phase = event.phase
156          this.round = event.round
157          this.ingest(event)
158        })
159      },
160  
161      unsubscribe(): void {
162        if (offProgress) offProgress()
163        offProgress = null
164      },
165  
166      /**
167       * Append a delta to the turn it belongs to, or open a new turn.
168       *
169       * ⚠ MATCHED AGAINST EVERY OPEN TURN, NOT JUST THE LAST ONE — and the first
170       * build got this wrong in exactly the case the protocol is built around. A
171       * blind round asks every member CONCURRENTLY, so their deltas interleave;
172       * comparing only against the newest message opened a fresh block on every
173       * switch between members. The live drive rendered 291 fragments for what
174       * should have been eight turns. The key is (member, phase, round) and it has
175       * to be looked up, because "the last one" is not the same thing.
176       */
177      ingest(event: CouncilProgressEvent): void {
178        const open = this.messages.find(
179          (m) => m.memberId === event.memberId && m.phase === event.phase && m.round === event.round
180        )
181        if (open) {
182          open.text += event.delta
183          return
184        }
185        this.messages.push({
186          memberId: event.memberId,
187          phase: event.phase,
188          round: event.round,
189          text: event.delta
190        })
191      },
192  
193      /** The MAIN-side native picker. The renderer never enumerates the
194       *  filesystem, and the path that comes back is re-validated by main on
195       *  start — the dialog is a convenience, not the boundary. */
196      async pickBrief(): Promise<void> {
197        this.error = null
198        const res = await window.chorus.pickCouncilBrief()
199        if ('cancelled' in res) return // a structured no-op, not an error
200        this.briefPath = res.path
201      },
202  
203      /**
204       * Run the council. ⚠ D14: the payload is a FRESH LITERAL built from
205       * primitives read out of state — handing a Pinia proxy to `ipcRenderer`
206       * fails Electron's structured clone at runtime with no compile-time signal.
207       */
208      async run(projectId: string | null): Promise<void> {
209        if (this.running || this.briefPath === null) return
210        this.running = true
211        this.error = null
212        this.findings = null
213        this.findingsPath = null
214        this.findingsError = null
215        this.accounting = null
216        this.costUsd = null
217        this.messages = []
218        this.phase = null
219        this.round = null
220        this.runId = null
221        // A stored transcript belonging to the PREVIOUS run must not survive into
222        // this one's panel — it would read as this run's own history.
223        this.clearTranscript()
224        try {
225          const res = await window.chorus.startCouncilRun({
226            project_id: projectId,
227            brief_path: String(this.briefPath)
228          })
229          if (!res.ok) {
230            this.error = res.reason
231            return
232          }
233          this.runId = res.run_id
234          this.findings = res.findings
235          this.findingsPath = res.findings_path
236          this.findingsError = res.findings_error
237          this.accounting = res.accounting
238          this.costUsd = res.cost_usd
239          this.phase = 'done'
240        } catch (err) {
241          this.error = err instanceof Error ? err.message : 'The council run failed.'
242        } finally {
243          this.running = false
244        }
245      },
246  
247      /**
248       * Load a stored run's transcript (D97). **Read-only, and it touches
249       * `messages` nowhere** — see the state comment.
250       *
251       * Superseded reads are dropped rather than applied late, the `loadMembers`
252       * idiom, on a token of its own.
253       */
254      async loadTranscript(runId: string): Promise<void> {
255        const seq = ++this.transcriptSeq
256        this.transcriptLoading = true
257        this.transcriptError = null
258        try {
259          const res = await window.chorus.getCouncilTranscript({ run_id: String(runId) })
260          if (seq !== this.transcriptSeq) return // superseded by a newer read
261          this.transcript = res.turns
262          this.transcriptTotal = res.total_turns
263          this.transcriptTruncated = res.truncated
264        } catch (err) {
265          if (seq !== this.transcriptSeq) return
266          this.transcript = null
267          this.transcriptError =
268            err instanceof Error ? err.message : 'That run’s transcript could not be read.'
269        } finally {
270          if (seq === this.transcriptSeq) this.transcriptLoading = false
271        }
272      },
273  
274      /** Dropped when the view closes, so a re-entry re-reads rather than showing
275       *  a transcript belonging to a run the user has moved on from. */
276      clearTranscript(): void {
277        this.transcriptSeq++
278        this.transcript = null
279        this.transcriptTotal = 0
280        this.transcriptTruncated = false
281        this.transcriptError = null
282        this.transcriptLoading = false
283      },
284  
285      /** `cancelled: false` means there was no such live run — a race the user
286       *  cannot see, and not an error worth showing them. */
287      async cancel(): Promise<void> {
288        if (this.runId === null) return
289        await window.chorus.cancelCouncilRun({ run_id: String(this.runId) })
290      }
291    }
292  })
293  
```

### Exhibit 9 — `src/main/services/apiSession.ts` (lines 1–713, 32911 bytes)

```ts
  1  import type { ApiLaunchSpec, ApiSessionHandle } from '../adapters/types'
  2  import type { FetchInitLike, FetchLike, FetchResponseLike } from './modelCatalog'
  3  
  4  /**
  5   * Task 3b-1: the api-mode session primitive — the ONE place Chorus holds a
  6   * conversation with a model over HTTP.
  7   *
  8   * ⚠ A STANDALONE FACTORY, OUTSIDE THE AGENT REGISTRY (D63 Q1, CR-3b.0, Option
  9   * D, 3-of-3 unanimous). It is not an adapter, is not registered, and does not
 10   * appear in `agentKindSchema`. `ApiAgentAdapter.startApiSession` stays declared
 11   * and DORMANT; implementing it *is* the D34-Q5 registry lift, and D52 gives
 12   * that to Phase 3d. When the lift happens the adapter method becomes a one-line
 13   * delegation to this function — which is why `types.ts` carries a compile-time
 14   * assertion tying the two signatures together.
 15   *
 16   * ⚠ THIS MODULE HOLDS NO SCRUBBER, AND MUST NOT GROW ONE (D63(d)).
 17   * The findings' §6 sketch put a `Pick<Scrubber, …>` on the deps; that
 18   * contradicts their own Q4 ruling, which puts scrubbing at the CONSUMER —
 19   * `createSessionOutput().ingest()`, driven from `for await (… of
 20   * handle.receive())`. It is not merely redundant: `createSessionOutput` builds
 21   * its own scrubber, and a scrubber HOLDS A CARRY across chunk boundaries.
 22   * `scrubber.ts:50-51` proves its ordering invariant for ONE scrubber, not for a
 23   * chain — two carries in series is unproven behaviour on the app's only
 24   * redaction path, and a second scrub path inside the producer is precisely the
 25   * shape `sessionOutput.ts` was extracted (D46) to prevent.
 26   *
 27   *   THE FACTORY EMITS RAW TEXT. THE CONSUMER SCRUBS. ONE SEAM (D45(1)).
 28   *
 29   * Deliberately free of electron, of storage, and of Zod — the type imports
 30   * above are `import type` and erase completely, so this module pulls in no
 31   * runtime edge to either. It is a pure transport with an injected `fetch`,
 32   * exactly as `modelCatalog.ts` and `openrouterKeys.ts` are.
 33   *
 34   * ⚠ THE CREDENTIAL APPEARS IN EXACTLY ONE PLACE: the `Authorization` header
 35   * built inside `send()`. Never a URL, never a query string, never a body field,
 36   * never a log line, and never an error message. The refusal vocabulary below is
 37   * a FIXED TABLE with zero interpolation of anything that arrived over the wire
 38   * — which is what makes "the credential is in no output" a structural property
 39   * rather than a hope (unit case 12).
 40   *
 41   * D4-verified 2026-07-26 against OpenRouter's own documentation (full record in
 42   * `_verify/3b-1/D4-VERIFICATION.md`):
 43   *   · POST `${baseUrl}/chat/completions`, body `{model, messages, stream:true}`
 44   *   · SSE framing: `data: ` prefix, `data: [DONE]` sentinel, and keep-alive
 45   *     COMMENT lines — OpenRouter emits `: OPENROUTER PROCESSING` — which a hand
 46   *     parser must skip before JSON.parse
 47   *   · `usage` arrives on the FINAL SSE message and needs NO request flag;
 48   *     `usage:{include:true}` / `stream_options:{include_usage:true}` are
 49   *     documented as deprecated and inert, so neither is sent
 50   *   · a 200 can carry an error IN-BAND mid-stream (top-level `error`,
 51   *     `finish_reason:'error'`), because the status is already committed — a
 52   *     decoder that reads only `choices[].delta.content` would render that as a
 53   *     silent truncation
 54   */
 55  
 56  /** Token counts as reported by the provider. All fields nullable: "not
 57   *  reported" and "zero" are different facts, and D55's denominator rule applies
 58   *  here too — a confident-looking zero is worse than a null. */
 59  export interface TokenUsage {
 60    readonly tokensIn: number | null
 61    readonly tokensOut: number | null
 62    readonly tokensCached: number | null
 63  }
 64  
 65  export interface ApiSessionDeps {
 66    /** Absolute endpoint base, e.g. `https://openrouter.ai/api/v1`. Required —
 67     *  there is no default, because a silent default is how a request reaches a
 68     *  provider the user did not choose. */
 69    readonly baseUrl: string
 70    /** Injected for testability, exactly as openrouterKeys.ts and modelCatalog.ts
 71     *  do. Defaults to global fetch. */
 72    readonly fetchImpl?: FetchLike
 73    /** Non-secret provider headers (D33 resolution e). */
 74    readonly extraHeaders?: Readonly<Record<string, string>>
 75    /** Hard ceiling on total streamed bytes. Default RESPONSE_CAP_BYTES. */
 76    readonly maxResponseBytes?: number
 77    /** Hard ceiling on wall-clock for one send/receive cycle. Default
 78     *  RESPONSE_TIMEOUT_MS. */
 79    readonly maxWallClockMs?: number
 80    /** ⚠ THE THIRD BOUND, and the only one that bounds SPEND rather than volume
 81     *  or time — `max_tokens` on the request. Deliberately OPTIONAL and
 82     *  deliberately WITHOUT a default: a silent output cap would truncate a
 83     *  council member's answer mid-sentence and look like a model behaviour, and
 84     *  a silent default is the same failure `baseUrl` refuses to have. Absent
 85     *  means the model's own default applies. D64(2)'s per-run minted-key cap is
 86     *  a different instrument at a different layer and belongs to Task 3b-3. */
 87    readonly maxOutputTokens?: number
 88    /** Session-scoped external abort. NOT per-operation cancellation (D63 Q3):
 89     *  it lets an owner — e.g. a council run — abort every member at once without
 90     *  tracking each handle. Linked to the same internal controller `dispose()`
 91     *  aborts. */
 92    readonly signal?: AbortSignal
 93    /**
 94     * ⚠ THE F39 INSTRUMENT (D96, Task 3e-1) — a DIAGNOSTIC, not a control. It
 95     * changes no bound and no behaviour; it reports what the bound saw.
 96     *
 97     * F39 asks whether `moonshotai/kimi-k3` is pathological or whether
 98     * RESPONSE_CAP_BYTES is simply too small for a model that streams its chain
 99     * of thought. The two answers have OPPOSITE fixes — drop the member, versus
100     * raise the cap — and until this hook existed the question was unanswerable
101     * from outside: `totalBytes` was accumulated, compared to the cap, and then
102     * discarded, so a refusal said "too large" and nothing else.
103     *
104     * ⚠ ITS FIRST USE ANSWERED A DIFFERENT QUESTION THAN EXPECTED, AND THE LESSON
105     * BELONGS NEXT TO THE HOOK. Run `4c17069c` measured 4,000,372 capped bytes
106     * against a 692,858-byte largest COMPLETED turn, and that 5.8× was first read
107     * as "pathological". The reading was retracted: bytes/token differs 20× ACROSS
108     * MODELS here (9.9 for opus-5, 205.1 for qwen3-coder), so a byte ratio between
109     * two models is not a ratio of how much they said. **A ratio is only
110     * meaningful when both measurements share a unit.** Divide by `onUsage`'s
111     * `tokens_out` before comparing anything this hook reports.
112     *
113     * ⚠ ONE CALL PER SEND/RECEIVE CYCLE, ON EVERY EXIT PATH — it fires from the
114     * `finally`, so a capped turn, a completed turn, a timeout and an interrupted
115     * read all report. That is deliberate: a refusal figure ALONE cannot
116     * distinguish F39's two hypotheses. "4 MB capped, largest completed turn
117     * 180 KB" says pathological; "4 MB capped, largest completed turn 3.6 MB"
118     * says the cap is too small. THE COMPARISON IS THE MEASUREMENT, so the
119     * successful turns must report too.
120     *
121     * ⚠ IT CARRIES NO STREAM CONTENT AND MUST NEVER BE WIDENED TO. Model output
122     * can contain a credential — that is why the scrub seam exists — and a
123     * diagnostic that leaked one would be a worse defect than the one it
124     * diagnoses. Byte counts only.
125     */
126    readonly onStreamBytes?: (info: {
127      /** Bytes received this cycle, including the frame that crossed the cap. */
128      readonly bytes: number
129      /** The cap in force, emitted alongside so the line stays readable after
130       *  the constant moves. */
131      readonly capBytes: number
132      /** True when the cap fired and refused this cycle. */
133      readonly capped: boolean
134    }) => void
135    /** D63(g). Optional because a consumer that does not meter must not be
136     *  obliged to carry it. NEVER routed through receive(): a final text yield
137     *  would flow through the scrubber and the ring buffer and be rendered in the
138     *  transcript as though the model had said it. Fires at most once per cycle,
139     *  and only when the provider actually reported usage. */
140    readonly onUsage?: (usage: TokenUsage) => void
141    /**
142     * How a failure becomes visible.
143     *
144     * ⚠ ON THE DEPS FOR THE SAME REASON `onUsage` IS (D63(g)), and the reasoning
145     * is worth stating because the tempting fix is again the wrong one.
146     * `ApiSessionHandle` is the SHARED primitive D45(2) binds the future
147     * interactive chat pane to, and D63 Q3 ratified it AS DECLARED — four
148     * members, no failure channel. But `receive()` yields `string`, so a refusal
149     * has nowhere to go: throwing out of the iteration is what unit case 11
150     * forbids, and a refusal yielded as text would be rendered as model output.
151     * `ApiSessionDeps` is the FACTORY's own contract, so the refusal lives here
152     * and the shared handle is untouched.
153     *
154     * A consumer that omits it sees a stream that simply ends. Every real
155     * consumer passes it — `api:probe` does, and that is how its `reason` field
156     * is filled. Fires AT MOST ONCE per cycle.
157     */
158    readonly onRefusal?: (reason: string) => void
159  }
160  
161  /**
162   * ⚠ MEASURED, NOT JUDGED — AND THE PREVIOUS VALUE WAS THE OTHER WAY ROUND.
163   *
164   * It was 4_000_000, argued as HALF `modelCatalog`'s `MODELS_RESPONSE_CAP_BYTES`
165   * on the reasoning that *"4 MB is roughly a million tokens of prose"*. **That
166   * arithmetic was about TEXT and this bound counts SSE FRAMES**, and the F39
167   * instrument measured the difference across two real runs:
168   *
169   * | model | bytes per OUTPUT TOKEN (worst observed) |
170   * |---|---|
171   * | `anthropic/claude-opus-5` | 13.7 |
172   * | `z-ai/glm-5.2` | 134.0 |
173   * | `qwen/qwen3-coder` | 213.3 |
174   * | `moonshotai/kimi-k3` | **407.2** |
175   *
176   * A 30× spread, and it is a property of each model's chunking granularity — not
177   * of how much it said. At 407 bytes/token, 4 MB is ~9,800 tokens, not a million:
178   * the cap was ~100× tighter than its own comment believed, for the one member
179   * that kept hitting it.
180   *
181   * **THE NUMBER, DERIVED PER MEMBER — each model's own worst ratio × its OWN
182   * allowance, never one model's ratio against another's allowance:**
183   *
184   *   kimi    407.2 × 16,000 = **6,515,200**  ← the binding case
185   *   qwen    213.3 × 16,000 =   3,412,800
186   *   glm     134.0 × 16,000 =   2,144,000
187   *   arbiter  13.7 × 32,000 =     438,400
188   *
189   * 8_000_000 is **1.23× the binding case**, and tolerates up to **500
190   * bytes/token** at a 16,000-token allowance.
191   *
192   * ⚠ THE FIRST VERSION OF THIS COMMENT DERIVED THE SAME NUMBER THE WRONG WAY —
193   * qwen's 205.1 ratio × the ARBITER's 32,000 allowance — which is a cross-model
194   * product, the exact unit error the 3e-1 retraction was filed for. It happened
195   * to land within 1% of the correct figure, which is precisely why it is called
196   * out here instead of quietly replaced.
197   *
198   * ⚠ AND IT IS LOAD-BEARING ON A REAL TURN, NOT ONLY ON ARITHMETIC. In run
199   * `c06874ad` kimi's critique streamed **4,168,377 bytes — 104% of the old
200   * cap** — and completed. Under 4_000_000 that turn refuses and the run is
201   * partial again. Its positions turn in the same run streamed 2,446,913, which
202   * the old cap would have passed: kimi's streams straddle the old line, and that
203   * variance is why the bound is derived from the allowance rather than from any
204   * single observation.
205   *
206   * ⚠ THIS DISSOLVES THE DELIBERATE ASYMMETRY WITH `modelCatalog`, AND THE
207   * DISSOLUTION IS THE POINT RATHER THAN AN OVERSIGHT. The asymmetry rested on a
208   * premise the measurement refuted — that a council answer over 4 MB is a
209   * runaway. Kimi's 4.17 MB critique was a 10,237-token answer inside a
210   * 16,000-token budget. The two caps are equal now because nobody has yet
211   * measured a reason for them to differ.
212   *
213   * ⚠ AND IT IS STILL THE WRONG SHAPE, WHICH IS RECORDED HERE RATHER THAN FIXED
214   * OUT OF SCOPE. A byte cap and a token allowance bounding the same stream
215   * without ever being reconciled is the actual defect F39 exposed; the honest fix
216   * is a PER-TURN bound derived from that turn's own allowance
217   * (`maxOutputTokens × a ratio ceiling`), which `maxResponseBytes` already
218   * accepts as a dep. That is a councilService change and 3e-2's scope does not
219   * reach it. **If a member ever exceeds 500 bytes/token, that fix is the answer —
220   * not another global raise.**
221   */
222  export const RESPONSE_CAP_BYTES = 8_000_000
223  
224  /**
225   * ⚠ NOT `openrouterKeys`' 10 s, and the difference is the point: a management
226   * API call is one round trip, while a reasoning model's FIRST token can
227   * legitimately take a minute.
228   *
229   * This bounds THE WHOLE CYCLE — the fetch round trip plus every read — not the
230   * gap between chunks. An idle-gap timeout is the more precise instrument and is
231   * deliberately NOT built here: it needs a measured idle distribution that
232   * nobody has yet, and guessing one would silently kill slow-but-healthy
233   * streams. Stated rather than silently chosen.
234   */
235  export const RESPONSE_TIMEOUT_MS = 120_000
236  
237  /**
238   * The fixed refusal vocabulary. NOTHING FROM THE WIRE IS EVER INTERPOLATED
239   * INTO ONE OF THESE — not the response body, not an exception message, not a
240   * `cause` chain.
241   *
242   * That is not caution for its own sake. D4-verified 2026-07-26: OpenRouter's
243   * error `metadata` can carry provider-returned content including
244   * `flagged_input`, which is an echo of the request; and a `TypeError: fetch
245   * failed` carries a `cause` chain that can include the request AND ITS HEADERS,
246   * which here means the credential. Both are discarded wholesale, exactly as
247   * `openrouterKeys.call` and `refreshProviderModels` discard them.
248   */
249  const API_SESSION_FAILURE = {
250    unreachable: 'Could not reach the provider.',
251    authFailed: 'Authentication failed — the credential was rejected.',
252    paymentRequired: 'The provider refused the request for insufficient credit.',
253    rateLimited: 'Rate limited by the provider.',
254    providerError: 'The provider returned an error.',
255    noStream: 'The provider returned no response stream.',
256    /** A frame that is not JSON, is not an object, or is a truncated tail. The
257     *  received shape is NEVER named — that is a body echo wearing a diagnostic
258     *  hat. */
259    unrecognized: 'The provider returned an unrecognized response stream.',
260    /** D4 obligation 3: a 200 whose stream carries an in-band `error`. */
261    midStream: 'The provider reported an error partway through the response.',
262    interrupted: 'The response stream ended unexpectedly.',
263    tooLarge: 'The response exceeded its size limit and was stopped.',
264    timedOut: 'The response exceeded its time limit and was stopped.',
265    busy: 'This session already has a request in flight.',
266    disposed: 'This session has been disposed.'
267  } as const
268  
269  function unexpectedStatusFailure(status: number): string {
270    return `Unexpected response (${status}).`
271  }
272  
273  /** `FetchInitLike` describes modelCatalog's GET and therefore has no `body`.
274   *  Extended rather than re-declared, per the spec's reuse instruction. */
275  interface ApiFetchInit extends FetchInitLike {
276    readonly body: string
277  }
278  
279  type BodyReader = ReturnType<NonNullable<FetchResponseLike['body']>['getReader']>
280  
281  interface ChatMessage {
282    readonly role: 'system' | 'user' | 'assistant'
283    readonly content: string
284  }
285  
286  /** Distinguishes "the wall clock won the race" from a real read result. A
287   *  symbol, so no response value can ever impersonate it. */
288  const DEADLINE = Symbol('api-session-deadline')
289  
290  export function createApiSession(spec: ApiLaunchSpec, deps: ApiSessionDeps): ApiSessionHandle {
291    const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike)
292    const maxResponseBytes = deps.maxResponseBytes ?? RESPONSE_CAP_BYTES
293    const maxWallClockMs = deps.maxWallClockMs ?? RESPONSE_TIMEOUT_MS
294    // A trailing slash is a KNOWN failure mode on this route (recorded in
295    // codexAdapter.buildLaunch and inherited by modelCatalog).
296    const baseUrl = deps.baseUrl.replace(/\/+$/, '')
297  
298    // ⚠ ONE controller for the whole session. `dispose()` aborts it, and D63 Q3
299    // ruled that dispose() is the SOLE cancellation mechanism — there is no
300    // per-operation cancel, deliberately.
301    const controller = new AbortController()
302  
303    const messages: ChatMessage[] = spec.systemPrompt
304      ? [{ role: 'system', content: spec.systemPrompt }]
305      : []
306  
307    // ⚠ The live reader stays visible to dispose() for as long as the request is
308    // in flight. An earlier shape had the iterator take ownership of it, which
309    // left dispose() with nothing to cancel the moment iteration began — i.e.
310    // exactly during the window dispose() exists for. `claimed` carries the
311    // single-consumption contract instead.
312    let stream: BodyReader | null = null
313    let claimed = false
314    let disposed = false
315    let aborted = false
316    let refused = false
317    let deadlineTimer: ReturnType<typeof setTimeout> | null = null
318    let deadlinePromise: Promise<typeof DEADLINE> | null = null
319  
320    // An external signal is LINKED, not adopted: the listener is removed on
321    // dispose so a long-lived owner signal (a council run outliving one member)
322    // cannot retain a dead session through its listener list.
323    const onExternalAbort = (): void => {
324      aborted = true
325      controller.abort()
326    }
327    if (deps.signal) {
328      if (deps.signal.aborted) onExternalAbort()
329      else deps.signal.addEventListener('abort', onExternalAbort)
330    }
331  
332    /** At most once per cycle (see `onRefusal`'s docstring). */
333    function refuse(reason: string): void {
334      if (refused) return
335      refused = true
336      deps.onRefusal?.(reason)
337    }
338  
339    function armDeadline(): void {
340      clearDeadline()
341      deadlinePromise = new Promise<typeof DEADLINE>((resolve) => {
342        deadlineTimer = setTimeout(() => resolve(DEADLINE), maxWallClockMs)
343      })
344    }
345  
346    function clearDeadline(): void {
347      if (deadlineTimer !== null) {
348        clearTimeout(deadlineTimer)
349        deadlineTimer = null
350      }
351      deadlinePromise = null
352    }
353  
354    async function cancelReader(r: BodyReader): Promise<void> {
355      await r.cancel().catch(() => undefined)
356    }
357  
358    /**
359     * ⚠ THE DANGEROUS PART. Three things a naive decoder gets wrong, each of
360     * which produces a bug invisible in a happy-path test:
361     *
362     *  1. A FRAME SPLIT ACROSS READS. `data: {"choi` / `ces":[…]}\n\n` must yield
363     *     once — so a partial line is buffered and NEVER parsed.
364     *  2. MULTIPLE FRAMES IN ONE READ. Split on the delimiter, not on the read
365     *     boundary.
366     *  3. A MULTI-BYTE CHARACTER SPLIT ACROSS READS. `TextDecoder` is used in
367     *     STREAMING mode; decoding each Uint8Array independently corrupts any
368     *     character straddling a boundary, and the failure is data-dependent —
369     *     it passes every ASCII test and appears the first time a council member
370     *     writes an em-dash.
371     *
372     * Single-consumption: the first iterator to start claims the reader, so a
373     * second `receive()` yields nothing rather than interleaving two consumers
374     * over one stream.
375     */
376    async function* drain(): AsyncGenerator<string, void, undefined> {
377      const active = stream
378      if (active === null || claimed) return
379      claimed = true
380  
381      const decoder = new TextDecoder()
382      const deadline = deadlinePromise
383      let lineBuffer = ''
384      let totalBytes = 0
385      // D96: set by the cap branch so the diagnostic emitted from `finally` can
386      // say WHICH bound ended the cycle. A plain flag rather than a richer
387      // outcome enum — the only distinction F39 needs is capped vs not.
388      let capped = false
389      let assistant = ''
390      let usage: TokenUsage | null = null
391  
392      // Set by the frame processor to end the stream; checked after each read so
393      // the yields below stay inside one loop body.
394      let sawDone = false
395      let failure: string | null = null
396  
397      /** Complete lines only. Returns the deltas this line contributed. */
398      const processLine = (rawLine: string): string | null => {
399        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
400        // Event separator.
401        if (line.length === 0) return null
402        // ⚠ D4-verified: OpenRouter emits `: OPENROUTER PROCESSING` keep-alives.
403        // Per the SSE spec a comment is ignorable, and JSON.parse would throw on
404        // one — which is how a keep-alive becomes a spurious refusal.
405        if (line.startsWith(':')) return null
406        // `event:` / `id:` / `retry:` fields are not used by this transport.
407        if (!line.startsWith('data:')) return null
408        // SSE strips ONE optional leading space from a field value.
409        const raw = line.slice('data:'.length)
410        const payload = raw.startsWith(' ') ? raw.slice(1) : raw
411        if (payload === '[DONE]') {
412          sawDone = true
413          return null
414        }
415        let frame: unknown
416        try {
417          frame = JSON.parse(payload)
418        } catch {
419          // The parse error names a byte offset and can quote content. Fixed
420          // string only — and a refusal, never a throw (unit case 11).
421          failure = API_SESSION_FAILURE.unrecognized
422          return null
423        }
424        const record = asRecord(frame)
425        if (record === null) {
426          failure = API_SESSION_FAILURE.unrecognized
427          return null
428        }
429        // D4 obligation 3: the status was already committed, so a mid-stream
430        // failure arrives here rather than as a non-2xx. Without this the stream
431        // would render as a silent truncation.
432        if (record.error !== undefined && record.error !== null) {
433          failure = API_SESSION_FAILURE.midStream
434          return null
435        }
436        const reported = readUsage(record)
437        if (reported !== null) usage = reported
438        return readDelta(record)
439      }
440  
441      try {
442        for (;;) {
443          if (aborted) return
444          // The deadline bounds the WHOLE cycle, so it is raced here as well as
445          // around the fetch in send().
446          const raced = deadline === null ? await active.read() : await Promise.race([active.read(), deadline])
447          if (raced === DEADLINE) {
448            // Cancel BEFORE abort so the underlying connection is released
449            // rather than left to GC (modelCatalog.readCapped's precedent).
450            await cancelReader(active)
451            controller.abort()
452            refuse(API_SESSION_FAILURE.timedOut)
453            return
454          }
455          if (raced.done) break
456          const value = raced.value
457          if (!value) continue
458  
459          totalBytes += value.byteLength
460          if (totalBytes > maxResponseBytes) {
461            // D96: record that the cap is what ended this cycle. The figure is
462            // emitted once, from the `finally` below, on every exit path.
463            capped = true
464            await cancelReader(active)
465            controller.abort()
466            refuse(API_SESSION_FAILURE.tooLarge)
467            return
468          }
469  
470          lineBuffer += decoder.decode(value, { stream: true })
471          const lines = lineBuffer.split('\n')
472          // The tail is a PARTIAL line and is held, never parsed.
473          lineBuffer = lines.pop() ?? ''
474          for (const rawLine of lines) {
475            // ⚠ Re-checked INSIDE the frame loop, not only at the top of the read
476            // loop. One read can carry several frames, so a dispose() between two
477            // yields would otherwise keep draining an already-received buffer —
478            // and a consumer counting "chunks after dispose" would read that as
479            // the request having run on, which is the opposite of the truth.
480            if (aborted) return
481            const delta = processLine(rawLine)
482            if (delta !== null && delta.length > 0) {
483              assistant += delta
484              yield delta
485            }
486            if (failure !== null || sawDone) break
487          }
488          if (failure !== null) {
489            await cancelReader(active)
490            controller.abort()
491            refuse(failure)
492            return
493          }
494          if (sawDone) break
495        }
496  
497        // Flush the streaming decoder and process a residual complete-looking
498        // line. A server that ended without its final newline would otherwise
499        // drop its last frame silently; a residual that does NOT parse is a
500        // truncation, and saying so beats reporting a short answer as complete.
501        if (!sawDone && !aborted) {
502          lineBuffer += decoder.decode()
503          const residual = lineBuffer.trim()
504          if (residual.length > 0 && residual.startsWith('data:')) {
505            const delta = processLine(residual)
506            if (delta !== null && delta.length > 0) {
507              assistant += delta
508              yield delta
509            }
510          }
511          if (failure !== null) {
512            refuse(failure)
513            return
514          }
515        }
516      } catch {
517        // A read rejects when the controller aborts (dispose, external signal, or
518        // one of the caps) and when the connection drops. Discarded WHOLESALE —
519        // an abort exception's cause chain can carry the request and its headers.
520        if (!aborted) refuse(API_SESSION_FAILURE.interrupted)
521        return
522      } finally {
523        // ⚠ D96 — EMITTED HERE, AND THE PLACEMENT IS THE POINT. `finally` is the
524        // one place every exit path passes through: capped, completed, timed
525        // out, interrupted, disposed. Reporting only at the refusal would give
526        // F39 a number with nothing to compare it against, which is the state
527        // that made the question unanswerable in the first place.
528        deps.onStreamBytes?.({ bytes: totalBytes, capBytes: maxResponseBytes, capped })
529        clearDeadline()
530        // The cycle is over: release the reader reference so a later send() is
531        // not refused as busy and dispose() has nothing stale to cancel.
532        if (stream === active) stream = null
533        // In-memory conversation state only; NO persistence (a non-goal — 3b-3
534        // decides what a council run stores). It is what makes a second send()
535        // on this handle a real second turn rather than an amnesiac first one.
536        if (assistant.length > 0) messages.push({ role: 'assistant', content: assistant })
537        if (usage !== null) deps.onUsage?.(usage)
538      }
539    }
540  
541    return {
542      sessionId: spec.sessionId,
543  
544      async send(message: string): Promise<void> {
545        if (disposed) {
546          refuse(API_SESSION_FAILURE.disposed)
547          return
548        }
549        if (stream !== null) {
550          refuse(API_SESSION_FAILURE.busy)
551          return
552        }
553        messages.push({ role: 'user', content: message })
554  
555        // The cycle's clock starts HERE, before the round trip — a provider that
556        // never answers is bounded by the same instrument as one that streams
557        // forever.
558        armDeadline()
559        const deadline = deadlinePromise
560  
561        const init: ApiFetchInit = {
562          method: 'POST',
563          headers: {
564            // ⚠ THE ONLY PLACE THE CREDENTIAL APPEARS.
565            authorization: `Bearer ${spec.credential.value}`,
566            'content-type': 'application/json',
567            accept: 'text/event-stream',
568            ...(deps.extraHeaders ?? {})
569          },
570          body: JSON.stringify({
571            model: spec.modelId,
572            messages,
573            stream: true,
574            // Omitted entirely when unset — an absent field is the model's own
575            // default, which is not the same as a guessed one.
576            ...(deps.maxOutputTokens === undefined ? {} : { max_tokens: deps.maxOutputTokens })
577          }),
578          signal: controller.signal
579        }
580  
581        let res: FetchResponseLike
582        try {
583          const raced =
584            deadline === null
585              ? await fetchImpl(`${baseUrl}/chat/completions`, init)
586              : await Promise.race([fetchImpl(`${baseUrl}/chat/completions`, init), deadline])
587          if (raced === DEADLINE) {
588            controller.abort()
589            clearDeadline()
590            refuse(API_SESSION_FAILURE.timedOut)
591            return
592          }
593          res = raced
594        } catch {
595          // Leakage path 2 (probeCredential's words): a fetch exception's cause
596          // chain can carry the request, headers included. Discard it wholesale.
597          clearDeadline()
598          if (aborted) return
599          refuse(API_SESSION_FAILURE.unreachable)
600          return
601        }
602  
603        // ⚠ A NON-2xx BODY IS CANCELLED UNREAD AND THE STATUS ALONE IS MAPPED
604        // (D58). This is the path most likely of all to echo a key, and
605        // D4-verified 2026-07-26 the error `metadata` can carry provider content
606        // including `flagged_input` — an echo of the request.
607        if (res.status < 200 || res.status >= 300) {
608          void res.body?.cancel().catch(() => undefined)
609          clearDeadline()
610          if (res.status === 401 || res.status === 403) refuse(API_SESSION_FAILURE.authFailed)
611          else if (res.status === 402) refuse(API_SESSION_FAILURE.paymentRequired)
612          else if (res.status === 429) refuse(API_SESSION_FAILURE.rateLimited)
613          else if (res.status >= 500) refuse(API_SESSION_FAILURE.providerError)
614          else refuse(unexpectedStatusFailure(res.status))
615          return
616        }
617  
618        const body = res.body
619        if (!body) {
620          clearDeadline()
621          refuse(API_SESSION_FAILURE.noStream)
622          return
623        }
624        stream = body.getReader()
625        claimed = false
626      },
627  
628      receive(): AsyncIterable<string> {
629        return drain()
630      },
631  
632      /**
633       * The SOLE cancellation mechanism (D63 Q3) — and NOT OPTIONAL, even on a
634       * cycle that already ended cleanly. Two things outlive a session that is
635       * merely finished, and both are released only here:
636       *
637       *  1. ⚠ THE DEADLINE TIMER. `send()` arms it before the round trip, so a
638       *     `send()` whose stream is never consumed leaves a `setTimeout` armed
639       *     for up to `maxWallClockMs` — 120 s by default — holding this closure,
640       *     and with it the credential-bearing request state, past any point the
641       *     caller still cares about. A NORMAL DRAIN clears it (drain's `finally`
642       *     calls `clearDeadline()`); an un-drained `send()` does not. Measured,
643       *     not assumed: instrumenting `setTimeout`/`clearTimeout` shows exactly
644       *     one timer still armed after `send()` with no `receive()`.
645       *
646       *  2. ⚠ THE EXTERNAL SIGNAL LISTENER. `deps.signal` is LINKED, not adopted,
647       *     and the listener is removed HERE and nowhere else — deliberately, but
648       *     it means a session that drained normally and was never disposed stays
649       *     on its owner's listener list. That matters precisely where the option
650       *     exists to be used: a council run holds ONE owner signal across every
651       *     member, so members that finished but were never disposed accumulate
652       *     on it for the life of the run.
653       *
654       * Neither is a correctness bug — both are bounded and neither can affect
655       * output — and neither is reachable except by skipping `dispose()`. They
656       * are the reason skipping it is a contract violation rather than a
657       * harmless shortcut. **Call it in a `finally`.**
658       *
659       * Idempotent: a second call is a no-op, so the `finally` costs nothing on
660       * a path that already disposed.
661       */
662      async dispose(): Promise<void> {
663        if (disposed) return
664        disposed = true
665        aborted = true
666        if (deps.signal) deps.signal.removeEventListener('abort', onExternalAbort)
667        clearDeadline()
668        // Abort first — the user asked to stop NOW — then AWAIT teardown, so a
669        // caller that awaits dispose() knows the reader is released rather than
670        // merely scheduled for release. (The cap paths cancel-then-abort instead:
671        // there the goal is to release a healthy connection cleanly.)
672        controller.abort()
673        const active = stream
674        stream = null
675        if (active !== null) await cancelReader(active)
676      }
677    }
678  }
679  
680  function asRecord(value: unknown): Record<string, unknown> | null {
681    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
682    return value as Record<string, unknown>
683  }
684  
685  /** `choices[0].delta.content`, defensively — every level may be absent on a
686   *  legitimate frame (the final usage-only frame carries `choices: []`). */
687  function readDelta(frame: Record<string, unknown>): string | null {
688    if (!Array.isArray(frame.choices)) return null
689    const choice = asRecord(frame.choices[0])
690    if (choice === null) return null
691    const delta = asRecord(choice.delta)
692    if (delta === null) return null
693    return typeof delta.content === 'string' ? delta.content : null
694  }
695  
696  /** D63(g) / D64(2). Null when the frame reports no usage — which is every
697   *  frame but the last. Each field is independently nullable: "not reported"
698   *  and "zero" are different facts (D55). */
699  function readUsage(frame: Record<string, unknown>): TokenUsage | null {
700    const usage = asRecord(frame.usage)
701    if (usage === null) return null
702    const promptDetails = asRecord(usage.prompt_tokens_details)
703    return {
704      tokensIn: numberOrNull(usage.prompt_tokens),
705      tokensOut: numberOrNull(usage.completion_tokens),
706      tokensCached: promptDetails === null ? null : numberOrNull(promptDetails.cached_tokens)
707    }
708  }
709  
710  function numberOrNull(value: unknown): number | null {
711    return typeof value === 'number' && Number.isFinite(value) ? value : null
712  }
713  
```

### Exhibit 10 — `src/renderer/src/views/SettingsProviders.vue` (lines 1–1380, 62358 bytes)

```vue
   1  <script setup lang="ts">
   2  import { computed, ref, watch } from 'vue'
   3  import {
   4    MANAGEMENT_AUTH_MODE,
   5    type ModelCatalogEntry,
   6    type ProviderConfig
   7  } from '../../../shared/ipc'
   8  import { useSettingsStore } from '../stores/settings'
   9  import ModelCombobox from '../components/ModelCombobox.vue'
  10  import SettingsCredentials from './SettingsCredentials.vue'
  11  
  12  /**
  13   * Providers content region (Task 3-4, spec §5; D38 grouped layout): one card
  14   * per provider with its credential rows nested inside — grouping is a
  15   * computed over the store's flat wire lists and mirrors the
  16   * provider_configs -> credential_profiles FK exactly. Provider create/edit
  17   * lives in a single inline form (create mode or edit mode); delete is the
  18   * WorktreePanel inline-confirm idiom with main's structured refusal rendered
  19   * inline (main is the authority — the renderer never pre-disables by
  20   * counting profiles, which could be stale).
  21   */
  22  const settings = useSettingsStore()
  23  
  24  /* ---- provider form (one instance, create or edit mode) ---- */
  25  const formOpen = ref(false)
  26  const editingId = ref<string | null>(null)
  27  const fName = ref('')
  28  const fAdapterId = ref('')
  29  const fAuthMode = ref('')
  30  const fEnvVar = ref('')
  31  const fBaseUrl = ref('')
  32  const fModel = ref('')
  33  const formBusy = ref(false)
  34  const formError = ref<string | null>(null)
  35  
  36  /* ---- delete confirm (one card at a time) ---- */
  37  const deleteConfirmId = ref<string | null>(null)
  38  const deleteBusy = ref(false)
  39  const deleteError = ref<string | null>(null)
  40  
  41  /** profiles grouped by providerId — presentation only; the store stays flat. */
  42  const profilesByProvider = computed(() => {
  43    const map = new Map<string, typeof settings.profiles>()
  44    for (const p of settings.profiles) {
  45      const list = map.get(p.providerId) ?? []
  46      list.push(p)
  47      map.set(p.providerId, list)
  48    }
  49    return map
  50  })
  51  
  52  const selectedAdapter = computed(
  53    () => settings.adapters.find((a) => a.id === fAdapterId.value) ?? null
  54  )
  55  const adapterAuthMethods = computed(() => selectedAdapter.value?.authMethods ?? [])
  56  
  57  /**
  58   * Task 3a-3 (D42's operational note): the ACCOUNT-LEVEL credential class.
  59   *
  60   * ⚠ THIS IS NOT AN ADAPTER AUTH METHOD, AND THAT IS THE WHOLE POINT. It is
  61   * appended here, from the shared IPC constant, rather than declared by
  62   * `claude.ts`/`codex.ts` — because widening `AuthMethodDefinition.type` would
  63   * make "Management key" appear in the LAUNCH picker as a way to run an agent.
  64   * That is semantically false (OpenRouter refuses management keys at the
  65   * completion endpoints) and it would push the highest-privilege credential in
  66   * the app toward the one path this task exists to keep it away from.
  67   *
  68   * Two guards keep it out of a launch, and neither lives in this file:
  69   *  - `LaunchDialog.vue` filters `auth_mode === 'api_key'`, so a management row
  70   *    is invisible to the picker for free;
  71   *  - `resolveCredential` in MAIN refuses it outright, before the decrypt —
  72   *    because main never trusts the renderer, and a filter here is not an
  73   *    invariant.
  74   */
  75  const MANAGEMENT_METHOD = {
  76    type: MANAGEMENT_AUTH_MODE,
  77    label: 'OpenRouter management key (account-level — cannot launch an agent)',
  78    requiredEnvVar: null
  79  } as const
  80  
  81  const authMethods = computed(() => [...adapterAuthMethods.value, MANAGEMENT_METHOD])
  82  
  83  /* ---- management routes: last, and shut ---------------------------------
  84   *
  85   * A management key mints and revokes the per-dispatch keys that meter spend.
  86   * It is the highest-privilege credential in the app and the one route that can
  87   * never launch anything — so it has no business sitting in the middle of the
  88   * list, open, looking exactly like the routes you use every day.
  89   *
  90   * Two cheap protections, both presentational (main's refusals are the real
  91   * guards — see MANAGEMENT_METHOD above): it sorts to the BOTTOM, and its card
  92   * renders SHUT until you deliberately open it.
  93   */
  94  function isManagement(provider: ProviderConfig): boolean {
  95    return provider.auth_mode === MANAGEMENT_AUTH_MODE
  96  }
  97  
  98  /** Working routes first, management routes last; original order preserved
  99   *  inside each group (a stable partition, not a sort — `providers` is ordered
 100   *  by main and that order still means something). */
 101  const orderedProviders = computed(() => [
 102    ...settings.providers.filter((p) => !isManagement(p)),
 103    ...settings.providers.filter(isManagement)
 104  ])
 105  
 106  /** Which management cards the user has opened THIS VISIT. Deliberately not
 107   *  persisted: "collapsed" is a protection, and a protection that remembers
 108   *  being switched off is not one. Every trip to settings starts shut. */
 109  const openedManagement = ref<Record<string, boolean>>({})
 110  
 111  function isCardOpen(provider: ProviderConfig): boolean {
 112    return !isManagement(provider) || openedManagement.value[provider.id] === true
 113  }
 114  
 115  function toggleCard(provider: ProviderConfig): void {
 116    if (!isManagement(provider)) return
 117    openedManagement.value[provider.id] = !openedManagement.value[provider.id]
 118  }
 119  
 120  /**
 121   * The eyebrow that opens a run of cards, or null mid-run. Emitted from inside
 122   * the single `v-for` rather than by splitting the loop in two — the card body
 123   * is ~180 lines of markup and duplicating it to get two headings is how the
 124   * two copies start to drift.
 125   */
 126  function groupHeadingFor(index: number): { label: string; note: string } | null {
 127    const provider = orderedProviders.value[index]
 128    const prev = index > 0 ? orderedProviders.value[index - 1] : null
 129    if (prev !== null && isManagement(prev) === isManagement(provider)) return null
 130    return isManagement(provider)
 131      ? { label: 'PROTECTED', note: 'account-level · mints and revokes keys · cannot launch an agent' }
 132      : { label: 'PROVIDERS', note: 'routes an agent can launch through' }
 133  }
 134  const selectedAuthMethod = computed(
 135    () => authMethods.value.find((m) => m.type === fAuthMode.value) ?? null
 136  )
 137  const managementSelected = computed(() => fAuthMode.value === MANAGEMENT_AUTH_MODE)
 138  
 139  /** Everything the selects render comes from adapter:list — no hardcoded
 140   *  adapter names, auth modes, or env-var strings in this file. */
 141  function adapterLabel(provider: ProviderConfig): string {
 142    return (
 143      settings.adapters.find((a) => a.id === provider.adapter_type)?.displayName ??
 144      provider.adapter_type
 145    )
 146  }
 147  function authLabel(provider: ProviderConfig): string {
 148    // 3a-3: the account-level class is not on any adapter, so it is resolved
 149    // first — otherwise a management row would render the bare column value.
 150    if (provider.auth_mode === MANAGEMENT_AUTH_MODE) return 'Management key · not launchable'
 151    const adapter = settings.adapters.find((a) => a.id === provider.adapter_type)
 152    return (
 153      adapter?.authMethods.find((m) => m.type === provider.auth_mode)?.label ?? provider.auth_mode
 154    )
 155  }
 156  
 157  /**
 158   * The mock's 18px provider tile carries a two-letter code (`an`, `oa`, `go`,
 159   * `or`). It is DERIVED from the provider's own name rather than looked up in a
 160   * table of known vendors: a table would have to answer "what tile does a
 161   * provider I have never heard of get", and D76 forbids rendering a placeholder.
 162   * The name is data the user typed, so an initialism of it invents nothing.
 163   */
 164  function providerCode(provider: ProviderConfig): string {
 165    const letters = provider.name.replace(/[^A-Za-z0-9]/g, '')
 166    return (letters.slice(0, 2) || '··').toLowerCase()
 167  }
 168  
 169  /**
 170   * The card header's status chip. ⚠ EVERY BRANCH CARRIES ITS DENOMINATOR (D55)
 171   * — "1 unavailable" alone would leave the reader guessing whether the other
 172   * credentials are fine. The mock's chip says "2 keys active"; this says how
 173   * many of how many, which is the same sentence with the missing half restored.
 174   */
 175  function credentialState(
 176    provider: ProviderConfig
 177  ): { tone: 'ok' | 'idle' | 'warn'; text: string } {
 178    const list = profilesByProvider.value.get(provider.id) ?? []
 179    if (list.length === 0) return { tone: 'idle', text: 'no credential stored' }
 180    const broken = list.filter((p) => p.unavailableSince).length
 181    if (broken > 0) {
 182      return { tone: 'warn', text: `${broken} of ${list.length} unavailable` }
 183    }
 184    const verified = list.filter((p) => p.lastVerifiedAt).length
 185    // ⚠ ZERO VERIFIED IS NOT A HEALTHY STATE, and the green tone would say it
 186    // was. Caught by looking at the running app: the management route reads
 187    // "0 of 1 verified" — true, and rendered in the same green as "1 of 1"
 188    // until this branch existed. The denominator was carrying the whole message
 189    // and the colour was contradicting it.
 190    return {
 191      tone: verified === 0 ? 'idle' : 'ok',
 192      text: `${verified} of ${list.length} verified`
 193    }
 194  }
 195  
 196  function openCreate(): void {
 197    formOpen.value = true
 198    editingId.value = null
 199    fName.value = ''
 200    fAdapterId.value = settings.adapters[0]?.id ?? ''
 201    fAuthMode.value = settings.adapters[0]?.authMethods[0]?.type ?? ''
 202    fEnvVar.value = ''
 203    fBaseUrl.value = ''
 204    fModel.value = ''
 205    formError.value = null
 206  }
 207  
 208  function openEdit(provider: ProviderConfig): void {
 209    formOpen.value = true
 210    editingId.value = provider.id
 211    fName.value = provider.name
 212    fAdapterId.value = provider.adapter_type
 213    fAuthMode.value = provider.auth_mode
 214    fEnvVar.value = provider.env_var_name ?? ''
 215    fBaseUrl.value = provider.base_url ?? ''
 216    fModel.value = provider.model ?? ''
 217    formError.value = null
 218    deleteConfirmId.value = null
 219  }
 220  
 221  function closeForm(): void {
 222    formOpen.value = false
 223    editingId.value = null
 224    formError.value = null
 225  }
 226  
 227  function onAdapterChange(): void {
 228    /**
 229     * An adapter switch invalidates the auth-mode choice ONLY IF the new adapter
 230     * cannot honour it. Keep a still-valid mode; fall back to the new adapter's
 231     * first declared method otherwise.
 232     *
 233     * ⚠ WHY THIS IS NOT "default to the first method" ANY MORE (2026-07-28,
 234     * observed live). Every adapter declares `subscription` FIRST, so the old
 235     * line silently rewrote a working `api_key` route to `subscription` on any
 236     * adapter change — and the rewrite is invisible: the auth select just moves,
 237     * the form still saves, and the damage only shows up later as a credential
 238     * that is no longer eligible in the launch dialog (`eligibleProfiles` filters
 239     * on `auth_mode === 'api_key'`). It bit the very first real use: repointing
 240     * `OpenRouter (route only)` from `none` to `opencode` turned a key-bearing
 241     * route into a subscription one, which is the exact opposite of the intent.
 242     *
 243     * `authMethods` (not `adapterAuthMethods`) is the right list to test against:
 244     * it includes MANAGEMENT_METHOD, which belongs to no adapter and must
 245     * therefore survive an adapter switch rather than being silently downgraded —
 246     * the management key is the highest-privilege credential in the app and
 247     * quietly relabelling it is the last thing this form should do.
 248     */
 249    const stillValid = authMethods.value.some((m) => m.type === fAuthMode.value)
 250    if (stillValid) return
 251    fAuthMode.value = selectedAdapter.value?.authMethods[0]?.type ?? ''
 252  }
 253  
 254  async function submitForm(): Promise<void> {
 255    if (!fName.value || !fAdapterId.value || !fAuthMode.value || formBusy.value) return
 256    formBusy.value = true
 257    formError.value = null
 258    try {
 259      // D14: fresh literals of primitives from component-local refs.
 260      // env_var_name is an OVERRIDE: empty means "use the adapter's default"
 261      // (create omits it; edit sends null to clear a previously set override).
 262      // base_url follows the same semantics: the route's OpenAI-compatible
 263      // endpoint (D47) — plaintext and documented non-secret (D33(e)).
 264      // model (D48) follows the same patch semantics: the route's DEFAULT
 265      // model id, hand-entered — there is deliberately NO list or fetch (a
 266      // model catalog is a hard non-goal).
 267      const reason =
 268        editingId.value === null
 269          ? await settings.createProvider({
 270              name: fName.value,
 271              adapter_type: fAdapterId.value,
 272              auth_mode: fAuthMode.value,
 273              ...(fEnvVar.value ? { env_var_name: fEnvVar.value } : {}),
 274              ...(fBaseUrl.value ? { base_url: fBaseUrl.value } : {}),
 275              ...(fModel.value ? { model: fModel.value } : {})
 276            })
 277          : await settings.updateProvider({
 278              id: editingId.value,
 279              name: fName.value,
 280              adapter_type: fAdapterId.value,
 281              auth_mode: fAuthMode.value,
 282              env_var_name: fEnvVar.value ? fEnvVar.value : null,
 283              base_url: fBaseUrl.value ? fBaseUrl.value : null,
 284              model: fModel.value ? fModel.value : null
 285            })
 286      if (reason !== null) {
 287        formError.value = reason // verbatim
 288        return
 289      }
 290      closeForm()
 291    } finally {
 292      formBusy.value = false
 293    }
 294  }
 295  
 296  function toggleDelete(id: string): void {
 297    deleteConfirmId.value = deleteConfirmId.value === id ? null : id
 298    deleteError.value = null
 299  }
 300  
 301  async function confirmDelete(id: string): Promise<void> {
 302    if (deleteBusy.value) return
 303    deleteBusy.value = true
 304    deleteError.value = null
 305    try {
 306      const reason = await settings.deleteProvider(id)
 307      if (reason !== null) {
 308        // 3-2's structured refusal (provider still has credential profiles) —
 309        // rendered inline, never thrown.
 310        deleteError.value = reason
 311        return
 312      }
 313      deleteConfirmId.value = null
 314    } finally {
 315      deleteBusy.value = false
 316    }
 317  }
 318  
 319  /* ---- Task 3a-4: the model catalog section -----------------------------
 320   *
 321   * ⚠ NOTHING HERE WRITES A PROVIDER'S `model`. The catalog is a LIST OF WHAT
 322   * EXISTS — it is not authoritative over the route's default, and a miss warns
 323   * rather than clearing, defaulting or substituting. The UI expression of that
 324   * ruling is the picker below: `fModel` STAYS A FREE-TEXT INPUT and the picker
 325   * is a <datalist> ATTACHED to it, never a closed <select>. A closed select
 326   * would make the catalog authoritative by UI construction, without anyone
 327   * deciding to — and it is the single most likely thing to be "cleaned up" by a
 328   * later contributor. */
 329  
 330  /** Which credential each card's Refresh will send, per provider. */
 331  const refreshCredential = ref<Record<string, string | null>>({})
 332  /** Main's sanitized refusal for a card's last refresh, rendered verbatim. */
 333  const refreshError = ref<Record<string, string | null>>({})
 334  
 335  /**
 336   * PURE READ of the cache when the provider list changes. This calls
 337   * `loadModels` and NOTHING ELSE: `refreshModels` — the live, key-bearing call
 338   * — is reachable ONLY from the Refresh button's click handler. There is no
 339   * boot hook, no settings-open hook, no timer and no watcher that fires it,
 340   * because a convenience refresh here would send the user's key without them
 341   * asking.
 342   */
 343  watch(
 344    () => settings.providers.map((p) => p.id).join(','),
 345    () => {
 346      for (const p of settings.providers) {
 347        void settings.loadModels(p.id)
 348        if (!(p.id in refreshCredential.value)) {
 349          const owned = profilesByProvider.value.get(p.id) ?? []
 350          // Exactly one profile -> that one. Zero OR several -> none, because
 351          // the unauthenticated path is a first-class shipped path and sending
 352          // a key nobody picked is the wrong default.
 353          refreshCredential.value[p.id] = owned.length === 1 ? owned[0].id : null
 354        }
 355      }
 356    },
 357    { immediate: true }
 358  )
 359  
 360  function catalogFor(providerId: string): ModelCatalogEntry[] {
 361    return settings.modelsByProvider[providerId]?.models ?? []
 362  }
 363  
 364  /** The three freshness states, straight from MAIN. The renderer stores no
 365   *  threshold and computes none — `freshness` is a fact it was handed. */
 366  function freshnessOf(providerId: string): 'never' | 'fresh' | 'stale' {
 367    return settings.modelsByProvider[providerId]?.freshness ?? 'never'
 368  }
 369  
 370  /** Display-only relative age. This is PRESENTATION, not policy: it decides
 371   *  nothing — the fresh/stale call was already made in main. */
 372  function ageLabel(providerId: string): string {
 373    const iso = settings.modelsByProvider[providerId]?.refreshedAt
 374    if (!iso) return ''
 375    const ms = Date.now() - Date.parse(iso)
 376    if (!Number.isFinite(ms) || ms < 0) return 'just now'
 377    const mins = Math.floor(ms / 60000)
 378    if (mins < 1) return 'just now'
 379    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
 380    const hours = Math.floor(mins / 60)
 381    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
 382    const days = Math.floor(hours / 24)
 383    return `${days} day${days === 1 ? '' : 's'} ago`
 384  }
 385  
 386  function isRefreshing(providerId: string): boolean {
 387    return settings.refreshingProviderIds.includes(providerId)
 388  }
 389  
 390  /** THE ONLY CALLER of the live refresh in this file, and it is a click. */
 391  async function onRefresh(providerId: string): Promise<void> {
 392    refreshError.value[providerId] = null
 393    const reason = await settings.refreshModels(
 394      providerId,
 395      refreshCredential.value[providerId] ?? null
 396    )
 397    // Verbatim from main, NEVER enriched with form values (spec §4.3 — the
 398    // likeliest way a secret reaches the DOM, and it looks like helpful
 399    // diagnostics while you write it).
 400    refreshError.value[providerId] = reason
 401  }
 402  
 403  /**
 404   * ⚠ WORKED EXAMPLE 8 — the route's default model was catalogued and has since
 405   * disappeared. It still launches; this is a warning, not a gate.
 406   *
 407   * ⚠ AND WORKED EXAMPLE 11, WHICH IS EQUALLY LOAD-BEARING: a model the catalog
 408   * has NEVER SEEN produces NO warning. An id that was never catalogued is not
 409   * the same fact as one that disappeared — users legitimately name ids a
 410   * provider's list does not carry, and a warning that fires on the normal case
 411   * is a warning nobody reads.
 412   */
 413  function missingRouteModel(provider: ProviderConfig): ModelCatalogEntry | null {
 414    if (!provider.model) return null
 415    const row = catalogFor(provider.id).find((m) => m.modelId === provider.model)
 416    if (!row || row.missingSince === null) return null
 417    return row
 418  }
 419  
 420  /** Worked example 12: the provider ANNOUNCED a retirement date, so the notice
 421   *  can fire BEFORE the model vanishes rather than after. Softer than the
 422   *  missing warning, and factual — the date is the provider's own. */
 423  function expiringRouteModel(provider: ProviderConfig): ModelCatalogEntry | null {
 424    if (!provider.model) return null
 425    const row = catalogFor(provider.id).find((m) => m.modelId === provider.model)
 426    if (!row || row.expiresAt === null || row.missingSince !== null) return null
 427    return row
 428  }
 429  
 430  function shortDate(iso: string): string {
 431    return iso.slice(0, 10)
 432  }
 433  
 434  /* ---- D85 (Task 3d-2): the model SHORTLIST -----------------------------
 435   *
 436   * OpenRouter returns ~340 models. A launch picker built on that is not a
 437   * picker, so the user marks the handful they actually intend to use.
 438   *
 439   * ⚠ THE INPUT IS FREE TEXT WITH A <datalist>, NOT A <select>, FOR THE THIRD
 440   * TIME IN THIS FILE — and for the same reason as the other two (D48/D56). The
 441   * catalog is a list of what a provider SAID EXISTS; it is not a list of what
 442   * the user is allowed to want. An id the catalog has never returned must be
 443   * shortlistable, so the shortlist is stored with no foreign key onto
 444   * `model_catalog` (v12) and this input refuses to constrain itself to it.
 445   *
 446   * ⚠ AND NOTHING HERE CALLS `refreshModels`. Shortlisting is a local write; a
 447   * "helpful" refresh-on-open would send the user's key on a gesture that asked
 448   * for nothing of the sort. Same rule as the Refresh button above: the live
 449   * call has exactly one caller and it is a click.
 450   */
 451  
 452  /** The pending free-text entry, per provider card. */
 453  const shortlistDraft = ref<Record<string, string>>({})
 454  
 455  /** Main's answer, never a local guess — the store replaces it wholesale from
 456   *  the write's response. */
 457  function shortlistFor(providerId: string): string[] {
 458    return settings.modelsByProvider[providerId]?.shortlist ?? []
 459  }
 460  
 461  /** Catalog ids NOT already shortlisted — the datalist's suggestions. Missing
 462   *  ids are not offered for new selections, exactly as in the two pickers
 463   *  above; they still RENDER wherever they are already named. */
 464  function shortlistSuggestions(providerId: string): ModelCatalogEntry[] {
 465    const chosen = new Set(shortlistFor(providerId))
 466    return catalogFor(providerId).filter((m) => m.missingSince === null && !chosen.has(m.modelId))
 467  }
 468  
 469  /** ⚠ A model on the shortlist that the last refresh did NOT return. This is
 470   *  shown rather than hidden: it is the user's own choice, and silently
 471   *  dropping it would be the catalog quietly overruling them. */
 472  function shortlistedMissing(providerId: string): Set<string> {
 473    const known = new Set(
 474      catalogFor(providerId)
 475        .filter((m) => m.missingSince === null)
 476        .map((m) => m.modelId)
 477    )
 478    const seenAtAll = catalogFor(providerId).length > 0
 479    if (!seenAtAll) return new Set() // never refreshed — absence proves nothing
 480    return new Set(shortlistFor(providerId).filter((id) => !known.has(id)))
 481  }
 482  
 483  /**
 484   * Add to the shortlist. `explicit` is the id the combobox submitted (a picked
 485   * suggestion or Enter on raw text); without it, the draft field is used — the
 486   * Add button's path.
 487   *
 488   * ⚠ THE ARGUMENT EXISTS BECAUSE OF A RACE, not for tidiness. The combobox
 489   * emits `update:modelValue` and `submit` for the same gesture, and reading the
 490   * draft here would depend on the v-model write having landed first. Taking the
 491   * value the event carried makes picking a suggestion deterministic.
 492   */
 493  async function addToShortlist(providerId: string, explicit?: string): Promise<void> {
 494    const id = (explicit ?? shortlistDraft.value[providerId] ?? '').trim()
 495    if (id === '') return
 496    const reason = await settings.setModelShortlisted(providerId, id, true)
 497    if (reason === null) shortlistDraft.value[providerId] = ''
 498  }
 499  
 500  async function removeFromShortlist(providerId: string, modelId: string): Promise<void> {
 501    await settings.setModelShortlisted(providerId, modelId, false)
 502  }
 503  
 504  /** The catalog for the provider currently being EDITED, which is the only one
 505   *  whose ids can meaningfully populate the form's picker (a provider being
 506   *  CREATED has no id and therefore no catalog yet). */
 507  const pickableModels = computed<ModelCatalogEntry[]>(() => {
 508    if (editingId.value === null) return []
 509    // ⚠ Missing models are NOT offered for new selections. They still RENDER
 510    // (struck through, on the card) wherever they are already named.
 511    return catalogFor(editingId.value).filter((m) => m.missingSince === null)
 512  })
 513  
 514  /* ------------------------------------------------------------------ */
 515  /* Task 3a-5 / D43: saved launch profiles — LIST, RENAME, DELETE only.  */
 516  /* No board, no panel, no dashboard: the place you PICK one is the      */
 517  /* launch dialog, and nothing here renders dispatch data or spend.      */
 518  /* ------------------------------------------------------------------ */
 519  
 520  const renamingProfileId = ref<string | null>(null)
 521  const renameLabel = ref('')
 522  const deletingProfileId = ref<string | null>(null)
 523  const profileError = ref('')
 524  
 525  void settings.loadLaunchProfiles()
 526  
 527  function beginRename(id: string, current: string): void {
 528    renamingProfileId.value = id
 529    renameLabel.value = current
 530    profileError.value = ''
 531  }
 532  
 533  async function commitRename(): Promise<void> {
 534    if (renamingProfileId.value === null || renameLabel.value.trim() === '') return
 535    // ⚠ D43: this is a PURE UI EVENT. Nothing downstream is rewritten — every
 536    // reference stores the immutable id.
 537    const reason = await settings.renameLaunchProfile(renamingProfileId.value, renameLabel.value.trim())
 538    if (reason !== null) {
 539      profileError.value = reason
 540      return
 541    }
 542    renamingProfileId.value = null
 543    profileError.value = ''
 544  }
 545  
 546  async function confirmDeleteProfile(id: string): Promise<void> {
 547    const reason = await settings.deleteLaunchProfile(id)
 548    deletingProfileId.value = null
 549    profileError.value = reason ?? ''
 550  }
 551  
 552  /* ------------------------------------------------------------------ */
 553  /* Task 3b-2 / D62: the council. WHO deliberates — list / create /      */
 554  /* rename / delete, and nothing else.                                   */
 555  /*                                                                      */
 556  /* ⚠ NOTHING IN THIS SECTION RUNS A COUNCIL, MAKES AN API CALL OR       */
 557  /* SPENDS A CENT. 3b-3 owns orchestration; 3b-4 owns the run view.      */
 558  /*                                                                      */
 559  /* ⚠ AND THERE IS DELIBERATELY NO "TEST THIS MEMBER" BUTTON. It would   */
 560  /* be a live billable /chat/completions call, and D57 is the standing   */
 561  /* warning about tests that cannot fail. If it is ever wanted, it        */
 562  /* belongs where the transport lives, not on a configuration form.      */
 563  /* ------------------------------------------------------------------ */
 564  
 565  const councilFormOpen = ref(false)
 566  const cLabel = ref('')
 567  const cCredentialId = ref('')
 568  const cModel = ref('')
 569  const cRole = ref<'member' | 'arbiter'>('member')
 570  const cParams = ref('')
 571  const councilBusy = ref(false)
 572  const councilFormError = ref('')
 573  const councilError = ref('')
 574  const renamingMemberId = ref<string | null>(null)
 575  const renameMemberLabel = ref('')
 576  const deletingMemberId = ref<string | null>(null)
 577  
 578  void settings.loadCouncilMembers()
 579  
 580  /**
 581   * ⚠ MANAGEMENT CREDENTIALS ARE NOT OFFERED, and the filter is NOT the
 582   * invariant. A management key is an ACCOUNT-LEVEL credential that mints and
 583   * revokes keys and cannot do inference (D42), so a member naming one could
 584   * never deliberate. This mirrors LaunchDialog.vue's `auth_mode === 'api_key'`
 585   * filter exactly — and, exactly as there, MAIN REFUSES IT ANYWAY, at create
 586   * (validateMemberShape) and again at resolve (resolveCouncilMember), because
 587   * main never trusts the renderer and `auth_mode` is an unconstrained TEXT
 588   * column that a hand-edited row can hold before any UI produces it. See D62:
 589   * 3a-5 shipped the version of this that trusted the filter.
 590   */
 591  const councilCredentials = computed(() =>
 592    settings.profiles.filter((p) => {
 593      const provider = settings.providers.find((r) => r.id === p.providerId)
 594      return provider !== undefined && provider.auth_mode !== MANAGEMENT_AUTH_MODE
 595    })
 596  )
 597  
 598  /** How many were excluded — said out loud, so an empty picker is never a
 599   *  mystery. Hiding the fact would make a broken configuration invisible. */
 600  const excludedManagementCount = computed(
 601    () => settings.profiles.length - councilCredentials.value.length
 602  )
 603  
 604  function credentialRouteName(credentialProfileId: string): string {
 605    const profile = settings.profiles.find((p) => p.id === credentialProfileId)
 606    if (!profile) return ''
 607    return settings.providers.find((r) => r.id === profile.providerId)?.name ?? ''
 608  }
 609  
 610  /** The route's own default model, shown as a HINT beside a NULL model input so
 611   *  the user can see what an empty field will inherit (D56 rank 2). It is a
 612   *  placeholder and a sentence — it is NEVER copied into the field, because that
 613   *  is the back-write into rank 1 that D48 exists to prevent. */
 614  const selectedRouteDefaultModel = computed<string | null>(() => {
 615    const profile = settings.profiles.find((p) => p.id === cCredentialId.value)
 616    if (!profile) return null
 617    return settings.providers.find((r) => r.id === profile.providerId)?.model ?? null
 618  })
 619  
 620  /**
 621   * ⚠ D56's THIRD ENFORCEMENT SITE. The catalog populates a <datalist> ATTACHED
 622   * to a FREE-TEXT input — it must never become a closed <select>. A dropdown
 623   * sourced from `model_catalog` would make the catalog AUTHORITATIVE BY UI
 624   * CONSTRUCTION, with nobody deciding to; a user has to be able to type an id
 625   * the catalog has never heard of. Missing ids are not offered for new
 626   * selections, exactly as in the provider form above.
 627   */
 628  const councilPickableModels = computed<ModelCatalogEntry[]>(() => {
 629    const profile = settings.profiles.find((p) => p.id === cCredentialId.value)
 630    if (!profile) return []
 631    return catalogFor(profile.providerId).filter((m) => m.missingSince === null)
 632  })
 633  
 634  function openCouncilCreate(): void {
 635    councilFormOpen.value = true
 636    cLabel.value = ''
 637    cCredentialId.value = councilCredentials.value[0]?.id ?? ''
 638    cModel.value = ''
 639    cRole.value = 'member'
 640    cParams.value = ''
 641    councilFormError.value = ''
 642  }
 643  
 644  async function submitCouncilMember(): Promise<void> {
 645    if (!cLabel.value.trim() || !cCredentialId.value || councilBusy.value) return
 646    councilBusy.value = true
 647    councilFormError.value = ''
 648    try {
 649      // D14: fresh literals of primitives from component-local refs — no Pinia
 650      // object crosses the bridge.
 651      //
 652      // ⚠ AN EMPTY MODEL FIELD SENDS `null`, NOT THE ROUTE'S DEFAULT. NULL means
 653      // "inherit at read time" (D56 rank 2); substituting the route's model here
 654      // would write rank 2 into rank 1 and create D48's second home from the UI
 655      // side, which is the single most tempting "helpful" line in this file.
 656      const reason = await settings.createCouncilMember({
 657        label: cLabel.value.trim(),
 658        credentialProfileId: cCredentialId.value,
 659        model: cModel.value.trim() ? cModel.value.trim() : null,
 660        role: cRole.value,
 661        paramsJson: cParams.value.trim() ? cParams.value.trim() : null
 662      })
 663      if (reason !== null) {
 664        councilFormError.value = reason // verbatim from main, never enriched
 665        return
 666      }
 667      councilFormOpen.value = false
 668    } finally {
 669      councilBusy.value = false
 670    }
 671  }
 672  
 673  function beginRenameMember(id: string, current: string): void {
 674    renamingMemberId.value = id
 675    renameMemberLabel.value = current
 676    councilError.value = ''
 677  }
 678  
 679  async function commitRenameMember(): Promise<void> {
 680    if (renamingMemberId.value === null || renameMemberLabel.value.trim() === '') return
 681    // ⚠ D43: a PURE UI EVENT. Nothing downstream is rewritten — every transcript
 682    // row stores the member's immutable id.
 683    const reason = await settings.renameCouncilMember(
 684      renamingMemberId.value,
 685      renameMemberLabel.value.trim()
 686    )
 687    if (reason !== null) {
 688      councilError.value = reason
 689      return
 690    }
 691    renamingMemberId.value = null
 692    councilError.value = ''
 693  }
 694  
 695  async function confirmDeleteMember(id: string): Promise<void> {
 696    const reason = await settings.deleteCouncilMember(id)
 697    deletingMemberId.value = null
 698    councilError.value = reason ?? ''
 699  }
 700  </script>
 701  
 702  <template>
 703    <div class="set-page max-w-4xl">
 704      <div class="set-head">
 705        <h1 class="set-title">Providers &amp; keys</h1>
 706        <span class="set-subtitle">encrypted with Windows DPAPI · keys never leave this machine</span>
 707        <span class="flex-1"></span>
 708        <button v-if="!formOpen" class="set-pill set-pill-lg" @click="openCreate">+ provider</button>
 709      </div>
 710  
 711      <!-- provider create/edit form. ⚠ UNMOCKED — the mock draws no open form,
 712           so this is token-and-primitive conformance, not a screenshot diff. -->
 713      <div v-if="formOpen" class="set-card p-4">
 714        <h2 class="set-section-title">
 715          {{ editingId === null ? 'Add provider' : 'Edit provider' }}
 716        </h2>
 717        <div class="mt-3 grid grid-cols-2 gap-3">
 718          <label class="set-field-label">
 719            Name
 720            <input
 721              v-model="fName"
 722              maxlength="120"
 723              placeholder='e.g. "Anthropic"'
 724              class="set-input mt-1 w-full"
 725            />
 726          </label>
 727          <label class="set-field-label">
 728            Adapter
 729            <select v-model="fAdapterId" class="set-select mt-1 w-full" @change="onAdapterChange">
 730              <option v-for="a in settings.adapters" :key="a.id" :value="a.id">
 731                {{ a.displayName }}
 732              </option>
 733            </select>
 734          </label>
 735          <label class="set-field-label">
 736            Auth method
 737            <select v-model="fAuthMode" class="set-select mt-1 w-full">
 738              <option v-for="m in authMethods" :key="m.type" :value="m.type">{{ m.label }}</option>
 739            </select>
 740            <!-- 3a-3: the account-level class needs its two properties said out
 741                 loud at the moment of choosing, because both are surprising:
 742                 it never launches anything, and testing it fails BY DESIGN. -->
 743            <span v-if="managementSelected" class="set-hint-warn mt-1 block">
 744              Mints and revokes the short-lived per-dispatch keys that meter spend. It can never launch an
 745              agent, and “test” will fail by design — OpenRouter blocks management keys from the
 746              completion endpoints.
 747            </span>
 748          </label>
 749          <label class="set-field-label">
 750            Env var name <span class="set-hint">(optional override)</span>
 751            <!-- Empty input, adapter default as PLACEHOLDER (spec §5): pre-filling
 752                 would persist a copy of today's default, so a later adapter
 753                 correction would silently not apply to this provider. -->
 754            <input
 755              v-model="fEnvVar"
 756              :placeholder="selectedAuthMethod?.requiredEnvVar ?? 'adapter default'"
 757              maxlength="120"
 758              class="set-input mt-1 w-full"
 759            />
 760          </label>
 761          <label class="set-field-label">
 762            Base URL <span class="set-hint">(optional — OpenAI-compatible endpoint)</span>
 763            <!-- D47: the route's endpoint (e.g. https://openrouter.ai/api/v1 —
 764                 no trailing slash). Plaintext, documented non-secret (D33(e)).
 765                 Empty = the provider's native default endpoint. -->
 766            <input
 767              v-model="fBaseUrl"
 768              placeholder="https://openrouter.ai/api/v1"
 769              maxlength="2048"
 770              class="set-input mt-1 w-full"
 771            />
 772          </label>
 773          <label class="set-field-label">
 774            Default model <span class="set-hint">(optional)</span>
 775            <!-- D48: the ROUTE's default model — a default, not an authority.
 776                 Task 3a-4 adds a catalog-sourced picker that is strictly
 777                 ADDITIVE: this stays a FREE-TEXT input with a <datalist>
 778                 attached, and must never become a closed <select>. A user has to
 779                 be able to type an id the catalog has never heard of — a closed
 780                 select would make the catalog authoritative by construction,
 781                 which is precisely the ruling this task exists to write down. -->
 782            <ModelCombobox
 783              v-model="fModel"
 784              :options="pickableModels"
 785              class="mt-1 w-full"
 786              placeholder='search, or type e.g. "moonshotai/kimi-k3"'
 787              :empty-hint="`${pickableModels.length} ids from the last refresh — type to search`"
 788            />
 789            <span v-if="editingId && pickableModels.length > 0" class="set-hint mt-1 block">
 790              {{ pickableModels.length }} model{{ pickableModels.length === 1 ? '' : 's' }} from the
 791              last refresh are offered as suggestions — any id can still be typed.
 792            </span>
 793          </label>
 794        </div>
 795        <p v-if="formError" class="set-error mt-2">{{ formError }}</p>
 796        <div class="mt-3 flex justify-end gap-2">
 797          <button class="set-action" @click="closeForm">Cancel</button>
 798          <button
 799            class="set-btn-primary"
 800            :disabled="!fName || !fAdapterId || !fAuthMode || formBusy"
 801            @click="submitForm"
 802          >
 803            {{ editingId === null ? 'Add provider' : 'Save changes' }}
 804          </button>
 805        </div>
 806      </div>
 807  
 808      <!-- loading / error / empty states -->
 809      <div v-if="settings.loading && settings.providers.length === 0" class="set-note">Loading…</div>
 810      <div v-else-if="settings.providers.length === 0" class="set-blank">
 811        No providers configured yet. Add a provider, then store a credential under it — keys are
 812        write-only and can be replaced but never read back.
 813      </div>
 814  
 815      <!-- one card per provider, credential rows nested inside (D38).
 816           Against the mock's provider card: 18px code tile, name, status chip,
 817           mono route meta on the right, actions.
 818           ⚠ ITERATES `orderedProviders`, NOT `settings.providers` — management
 819           routes sort to the bottom. The store stays in main's order. -->
 820      <template v-for="(provider, i) in orderedProviders" :key="provider.id">
 821        <div v-if="groupHeadingFor(i)" class="set-group">
 822          <span class="set-group-label">{{ groupHeadingFor(i)!.label }}</span>
 823          <span class="set-group-rule"></span>
 824          <span class="set-group-note">{{ groupHeadingFor(i)!.note }}</span>
 825        </div>
 826  
 827        <div class="set-card" :class="isManagement(provider) && 'set-card-protected'">
 828          <div
 829            class="set-card-head"
 830            :class="isCardOpen(provider) && 'set-card-head-ruled'"
 831            :data-provider-card="provider.id"
 832            :data-provider-open="isCardOpen(provider)"
 833          >
 834            <!-- The disclosure, on protected cards only. Everything else is
 835                 always open; a chevron there would be ceremony. -->
 836            <button
 837              v-if="isManagement(provider)"
 838              class="set-card-toggle"
 839              :title="isCardOpen(provider) ? 'Close this protected route' : 'Open this protected route'"
 840              :aria-expanded="isCardOpen(provider)"
 841              :data-provider-toggle="provider.id"
 842              @click="toggleCard(provider)"
 843            >
 844              <svg
 845                width="10"
 846                height="10"
 847                viewBox="0 0 12 12"
 848                fill="none"
 849                stroke="currentColor"
 850                stroke-width="1.4"
 851                stroke-linecap="round"
 852                stroke-linejoin="round"
 853                aria-hidden="true"
 854              >
 855                <path :d="isCardOpen(provider) ? 'M3 4.5 6 7.5l3-3' : 'M4.5 3 7.5 6l-3 3'" />
 856              </svg>
 857            </button>
 858            <span class="set-tile">{{ providerCode(provider) }}</span>
 859            <span class="set-card-name">{{ provider.name }}</span>
 860            <span class="set-chip" :class="`set-chip-${credentialState(provider).tone}`">
 861              <span class="set-chip-dot"></span>
 862              {{ credentialState(provider).text }}
 863            </span>
 864            <span class="flex-1"></span>
 865            <span
 866              class="set-meta min-w-0 truncate"
 867              :title="`${adapterLabel(provider)} · ${authLabel(provider)}`"
 868            >
 869              {{ adapterLabel(provider) }} · {{ authLabel(provider) }}
 870              <template v-if="provider.env_var_name"> · {{ provider.env_var_name }}</template>
 871              <template v-if="provider.base_url"> · {{ provider.base_url }}</template>
 872              <template v-if="provider.model"> · {{ provider.model }}</template>
 873            </span>
 874            <!-- ⚠ EDIT AND DELETE ARE BEHIND THE DISCLOSURE ON A PROTECTED CARD.
 875                 Leaving them on a shut card would keep the accident this collapse
 876                 exists to prevent one click away, which is where it already was. -->
 877            <template v-if="isCardOpen(provider)">
 878              <button class="set-action" @click="openEdit(provider)">edit</button>
 879              <button class="set-action set-action-danger" @click="toggleDelete(provider.id)">
 880                delete
 881              </button>
 882            </template>
 883          </div>
 884  
 885          <template v-if="isCardOpen(provider)">
 886        <!-- inline delete confirmation; main's refusal renders here -->
 887        <div v-if="deleteConfirmId === provider.id" class="set-row-block px-4 py-2">
 888          <div class="set-confirm">
 889            <p class="set-note">
 890              Delete provider <span class="set-strong">{{ provider.name }}</span
 891              >?
 892            </p>
 893            <div class="mt-2 flex items-center justify-end gap-2">
 894              <span v-if="deleteError" class="set-error mr-auto min-w-0 truncate" :title="deleteError">
 895                {{ deleteError }}
 896              </span>
 897              <button class="set-action" @click="toggleDelete(provider.id)">Cancel</button>
 898              <button class="set-btn-danger" :disabled="deleteBusy" @click="confirmDelete(provider.id)">
 899                Delete provider
 900              </button>
 901            </div>
 902          </div>
 903        </div>
 904  
 905        <SettingsCredentials
 906          :provider="provider"
 907          :profiles="profilesByProvider.get(provider.id) ?? []"
 908          :auth-label="authLabel(provider)"
 909        />
 910  
 911        <!-- Task 3a-4: the model catalog. A CACHE of what this route offers —
 912             it never changes what launches, and nothing below writes the
 913             provider's `model`. -->
 914        <div class="set-row-block px-4 py-2.5" data-models-section>
 915          <div class="flex items-center gap-2">
 916            <span class="set-section-title">Models</span>
 917  
 918            <!-- THREE STATES, RENDERED AS THREE DIFFERENT THINGS. 'never' is its
 919                 own thing — not a spinner, and not an empty list styled as
 920                 stale. An implementation that renders it through the stale
 921                 branch looks right on a populated database and wrong on every
 922                 fresh install, which is every new user. -->
 923            <span
 924              v-if="freshnessOf(provider.id) === 'never'"
 925              class="set-meta"
 926              data-models-freshness="never"
 927            >
 928              No model list yet
 929            </span>
 930            <span
 931              v-else-if="freshnessOf(provider.id) === 'fresh'"
 932              class="set-meta"
 933              data-models-freshness="fresh"
 934            >
 935              {{ catalogFor(provider.id).length }} models · updated {{ ageLabel(provider.id) }}
 936            </span>
 937            <span v-else class="set-row-warn" data-models-freshness="stale">
 938              ⚠ {{ catalogFor(provider.id).length }} models · last updated {{ ageLabel(provider.id) }}
 939            </span>
 940  
 941            <span class="flex-1"></span>
 942  
 943            <!-- The credential is OPTIONAL: "no credential" is a first-class
 944                 shipped path, not a fallback. -->
 945            <select
 946              v-if="(profilesByProvider.get(provider.id) ?? []).length > 0"
 947              v-model="refreshCredential[provider.id]"
 948              class="set-select set-select-sm"
 949              data-models-credential
 950            >
 951              <option :value="null">no credential</option>
 952              <option v-for="p in profilesByProvider.get(provider.id) ?? []" :key="p.id" :value="p.id">
 953                {{ p.label }}
 954              </option>
 955            </select>
 956            <button
 957              class="set-pill"
 958              :disabled="isRefreshing(provider.id)"
 959              data-models-refresh
 960              @click="onRefresh(provider.id)"
 961            >
 962              {{ isRefreshing(provider.id) ? 'Refreshing…' : 'Refresh' }}
 963            </button>
 964          </div>
 965  
 966          <!-- main's sanitized reason, VERBATIM -->
 967          <p v-if="refreshError[provider.id]" class="set-error mt-1.5" data-models-error>
 968            {{ refreshError[provider.id] }}
 969          </p>
 970  
 971          <!-- ⚠ WORKED EXAMPLE 8. The route still launches — nothing is
 972               cleared, substituted or blocked. This is the whole point of the
 973               table: make the F-36-4 failure legible EARLY, at pick time,
 974               instead of at launch as a sanitized "Unexpected response (400)." -->
 975          <p
 976            v-if="missingRouteModel(provider)"
 977            class="set-hint-warn mt-1.5 block"
 978            data-models-missing-warning
 979          >
 980            ⚠ <span class="set-mono">{{ provider.model }}</span> was not in the last refresh ({{
 981              shortDate(missingRouteModel(provider)!.missingSince!)
 982            }}). It may have been retired — launches naming it will fail at the provider.
 983          </p>
 984  
 985          <!-- Worked example 12: the provider announced a retirement date. -->
 986          <p
 987            v-else-if="expiringRouteModel(provider)"
 988            class="set-note mt-1.5"
 989            data-models-expiry-notice
 990          >
 991            The provider lists <span class="set-mono">{{ provider.model }}</span> as retiring on
 992            {{ expiringRouteModel(provider)!.expiresAt }}.
 993          </p>
 994  
 995          <!-- ⚠ THE CATALOG IS NO LONGER DRAWN AS A LIST OF CHIPS, AND THE
 996               REASONING THAT PUT IT THERE IS WORTH KEEPING. It existed so a
 997               stale list stayed visible — "hiding it would push the user back to
 998               typing ids from memory", the behaviour that produced kimi-k2.7.
 999               That need is now met better: the searchable picker below is fed by
1000               this same catalog, so every catalogued id is one keystroke away
1001               instead of twelve-of-343 being spilled onto the page. The count and
1002               the freshness line above still say what was fetched and when, which
1003               is the part that was carrying the warning. Nothing was hidden;
1004               it moved somewhere you can actually search it. -->
1005  
1006          <!-- D85: the SHORTLIST. Distinct from the cache above it in both
1007               direction and authority — that list is what the provider says
1008               exists, this one is what the USER chose, and no refresh may ever
1009               write it. Rendered for every route, including one with no catalog
1010               at all: an id can be shortlisted before any refresh has run. -->
1011          <!-- ⚠ UNMOCKED. `Chorus Settings Providers.dc.html` was drawn before
1012               D85 existed and says nothing about a shortlist — token-and-
1013               primitive conformance only, recorded as such in the 3c-5 report
1014               rather than presented as a match. -->
1015          <div class="set-subsection mt-2 pt-2" data-shortlist-section>
1016            <div class="flex items-center gap-2">
1017              <span class="set-section-title">Shortlist</span>
1018              <span class="set-meta">
1019                {{
1020                  shortlistFor(provider.id).length === 0
1021                    ? 'the models you actually use — these are what a launch offers'
1022                    : `${shortlistFor(provider.id).length} chosen`
1023                }}
1024              </span>
1025            </div>
1026  
1027            <div class="mt-1.5 flex items-center gap-2">
1028              <!-- ⚠ STILL FREE TEXT, NEVER A <select> (D48/D56, third enforcement
1029                   site in this file) — the <datalist> became a real searchable
1030                   panel, which is a change of AFFORDANCE, not of authority. The
1031                   catalog suggests; it does not decide. See ModelCombobox.vue,
1032                   where the "no highlight -> submit the raw text" branch is what
1033                   keeps an uncatalogued id reachable. Picking a suggestion adds
1034                   it immediately: that is the gesture the datalist was failing
1035                   to offer. -->
1036              <ModelCombobox
1037                v-model="shortlistDraft[provider.id]"
1038                :options="shortlistSuggestions(provider.id)"
1039                input-class="set-input-sm"
1040                class="w-72"
1041                placeholder="search or type any model id"
1042                :empty-hint="`${shortlistSuggestions(provider.id).length} catalogued ids — type to search`"
1043                :data-shortlist-input="provider.id"
1044                @submit="(id: string) => addToShortlist(provider.id, id)"
1045              />
1046              <!-- ⚠ `set-pill-pending`, NOT PLAIN `:disabled`. An empty field
1047                   means "nothing to add yet", but the shared disabled style paints
1048                   `cursor: not-allowed` — which reads as "you are not permitted to
1049                   shortlist", and did: it was reported as being blocked from
1050                   adding. Same disabled state, honest cursor, and a title that
1051                   says what to do. -->
1052              <button
1053                class="set-pill set-pill-pending"
1054                :disabled="!(shortlistDraft[provider.id] ?? '').trim()"
1055                :title="
1056                  (shortlistDraft[provider.id] ?? '').trim()
1057                    ? 'Add this model id to the shortlist'
1058                    : 'Search or type a model id first — then Add'
1059                "
1060                :data-shortlist-add="provider.id"
1061                @click="addToShortlist(provider.id)"
1062              >
1063                Add
1064              </button>
1065            </div>
1066  
1067            <div v-if="shortlistFor(provider.id).length > 0" class="mt-1.5 flex flex-wrap gap-1">
1068              <span
1069                v-for="id in shortlistFor(provider.id)"
1070                :key="id"
1071                class="set-model-chip flex items-center gap-1"
1072                :class="shortlistedMissing(provider.id).has(id) && 'set-model-chip-kept'"
1073                :title="
1074                  shortlistedMissing(provider.id).has(id)
1075                    ? 'not in the last refresh — kept, because it is your choice, not the catalog’s'
1076                    : id
1077                "
1078              >
1079                {{ id }}
1080                <button
1081                  class="set-chip-x"
1082                  :data-shortlist-remove="id"
1083                  @click="removeFromShortlist(provider.id, id)"
1084                >
1085                  ✕
1086                </button>
1087              </span>
1088            </div>
1089          </div>
1090        </div>
1091          </template>
1092  
1093          <!-- What a shut protected card says instead of its body. It names the
1094               route's purpose so the card is still legible closed — a bare
1095               chevron would make the user open it to find out what it is, which
1096               is the click this collapse exists to avoid. -->
1097          <p v-else class="set-protected-note" :data-provider-closed="provider.id">
1098            Closed by default so it is not touched by accident. It mints and revokes the short-lived
1099            keys that meter spend, and can never launch an agent.
1100          </p>
1101        </div>
1102      </template>
1103  
1104      <!-- 3a-5 (D43): saved launch profiles. Rendered only when some exist —
1105           with none, this view is byte-for-byte the pre-3a-5 view. -->
1106      <template v-if="settings.launchProfiles.length > 0">
1107        <div class="set-group">
1108          <span class="set-group-label">LAUNCH PROFILES</span>
1109          <span class="set-group-rule"></span>
1110          <span class="set-group-note">saved picks · chosen in the launch dialog</span>
1111        </div>
1112      </template>
1113      <div v-if="settings.launchProfiles.length > 0" class="set-card">
1114        <div class="set-card-head set-card-head-ruled">
1115          <h2 class="set-card-name">Saved launch profiles</h2>
1116          <span class="set-meta">
1117            pick one in the launch dialog · renaming here changes nothing else
1118          </span>
1119        </div>
1120        <p v-if="profileError" class="set-error px-4 pt-2">{{ profileError }}</p>
1121        <ul class="flex flex-col">
1122          <li
1123            v-for="p in settings.launchProfiles"
1124            :key="p.id"
1125            class="set-row"
1126            data-launch-profile-row
1127          >
1128            <template v-if="renamingProfileId === p.id">
1129              <input
1130                v-model="renameLabel"
1131                class="set-input set-input-sm flex-1"
1132                data-rename-input
1133                @keydown.enter="commitRename"
1134                @keydown.esc="renamingProfileId = null"
1135              />
1136              <button class="set-action" data-rename-confirm @click="commitRename">Save</button>
1137              <button class="set-action" @click="renamingProfileId = null">Cancel</button>
1138            </template>
1139            <template v-else>
1140              <span class="set-row-name">{{ p.label }}</span>
1141              <span class="set-row-detail min-w-0 truncate">
1142                {{ p.agent }}{{ p.provider_name ? ' · ' + p.provider_name : '' }}
1143                {{ p.model ? ' · ' + p.model : '' }}
1144                {{ p.credential_label ? ' · ' + p.credential_label : '' }}
1145              </span>
1146              <!-- SHOWN, DISABLED AND EXPLAINED — never hidden. -->
1147              <span v-if="p.disabled_reason" class="set-row-warn">⚠ {{ p.disabled_reason }}</span>
1148              <span class="flex-1"></span>
1149              <button class="set-action" data-rename-profile @click="beginRename(p.id, p.label)">
1150                Rename
1151              </button>
1152              <template v-if="deletingProfileId === p.id">
1153                <span class="set-meta">delete?</span>
1154                <button
1155                  class="set-action set-action-danger"
1156                  data-delete-confirm
1157                  @click="confirmDeleteProfile(p.id)"
1158                >
1159                  Yes
1160                </button>
1161                <button class="set-action" @click="deletingProfileId = null">No</button>
1162              </template>
1163              <button
1164                v-else
1165                class="set-action"
1166                data-delete-profile
1167                @click="deletingProfileId = p.id"
1168              >
1169                Delete
1170              </button>
1171            </template>
1172          </li>
1173        </ul>
1174      </div>
1175  
1176      <!-- 3b-2 (D62): the council's members. WHO deliberates — nothing here runs
1177           a council, calls an API, or spends anything. -->
1178      <!-- ⚠ UNMOCKED. The settings mock predates 3b-2 and contains the word
1179           "council" zero times — token-and-primitive conformance only. -->
1180      <div class="set-group">
1181        <span class="set-group-label">COUNCIL</span>
1182        <span class="set-group-rule"></span>
1183        <span class="set-group-note">who deliberates · nothing here runs one</span>
1184      </div>
1185      <div class="set-card" data-council-section>
1186        <div class="set-card-head set-card-head-ruled">
1187          <h2 class="set-card-name">Council members</h2>
1188          <span class="set-meta">
1189            who deliberates · a member names its route by naming a credential
1190          </span>
1191          <span class="flex-1"></span>
1192          <button
1193            v-if="!councilFormOpen"
1194            class="set-pill"
1195            :disabled="councilCredentials.length === 0"
1196            data-council-add
1197            @click="openCouncilCreate"
1198          >
1199            + member
1200          </button>
1201        </div>
1202  
1203        <!-- create form -->
1204        <div v-if="councilFormOpen" class="set-row-block p-4" data-council-form>
1205          <div class="grid grid-cols-2 gap-3">
1206            <label class="set-field-label">
1207              Name
1208              <input
1209                v-model="cLabel"
1210                maxlength="120"
1211                placeholder='e.g. "OpenRouter/kimi-k3"'
1212                class="set-input mt-1 w-full"
1213                data-council-label
1214              />
1215            </label>
1216            <label class="set-field-label">
1217              Credential
1218              <!-- The credential IS the route (D48): there is no base-URL field
1219                   and no route picker on this form, because there is no such
1220                   column on the row. -->
1221              <select v-model="cCredentialId" class="set-select mt-1 w-full" data-council-credential>
1222                <option v-for="p in councilCredentials" :key="p.id" :value="p.id">
1223                  {{ p.label }}{{ credentialRouteName(p.id) ? ' · ' + credentialRouteName(p.id) : '' }}
1224                </option>
1225              </select>
1226              <span v-if="excludedManagementCount > 0" class="set-hint mt-1 block">
1227                {{ excludedManagementCount }} management
1228                credential{{ excludedManagementCount === 1 ? '' : 's' }} not offered — a management
1229                key mints and revokes keys and cannot do inference.
1230              </span>
1231            </label>
1232            <label class="set-field-label">
1233              Model <span class="set-hint">(optional)</span>
1234              <!-- ⚠ D56's THIRD ENFORCEMENT SITE. FREE TEXT with an ADDITIVE
1235                   <datalist>, never a closed <select> — a closed select sourced
1236                   from model_catalog would make the catalog authoritative by UI
1237                   construction, with nobody deciding to. -->
1238              <ModelCombobox
1239                v-model="cModel"
1240                :options="councilPickableModels"
1241                class="mt-1 w-full"
1242                :placeholder="selectedRouteDefaultModel ?? 'the route’s default'"
1243                :empty-hint="`${councilPickableModels.length} ids on this route — type to search`"
1244                data-council-model
1245              />
1246              <!-- The route default is a SENTENCE, never a prefilled value:
1247                   copying it into the field is the rank-2-into-rank-1 back-write
1248                   D48 exists to prevent. -->
1249              <span v-if="selectedRouteDefaultModel" class="set-hint mt-1 block" data-council-inherit-hint>
1250                Leave empty to inherit this route’s default
1251                (<span class="set-mono">{{ selectedRouteDefaultModel }}</span>) at run time — the
1252                member’s own model stays unset.
1253              </span>
1254            </label>
1255            <label class="set-field-label">
1256              Role
1257              <select v-model="cRole" class="set-select mt-1 w-full" data-council-role>
1258                <option value="member">member — argues a position</option>
1259                <option value="arbiter">arbiter — rules on disagreement</option>
1260              </select>
1261            </label>
1262            <label class="set-field-label col-span-2">
1263              Parameters <span class="set-hint">(optional JSON — e.g. temperature)</span>
1264              <input
1265                v-model="cParams"
1266                maxlength="4096"
1267                placeholder='{"temperature": 0.2}'
1268                class="set-input mt-1 w-full"
1269                data-council-params
1270              />
1271              <span class="set-hint mt-1 block">
1272                Stored in plaintext and never read back — a value that looks like a key is refused.
1273              </span>
1274            </label>
1275          </div>
1276          <p v-if="councilFormError" class="set-error mt-2" data-council-form-error>
1277            {{ councilFormError }}
1278          </p>
1279          <div class="mt-3 flex justify-end gap-2">
1280            <button class="set-action" @click="councilFormOpen = false">Cancel</button>
1281            <button
1282              class="set-btn-primary"
1283              :disabled="!cLabel.trim() || !cCredentialId || councilBusy"
1284              data-council-submit
1285              @click="submitCouncilMember"
1286            >
1287              Add member
1288            </button>
1289          </div>
1290        </div>
1291  
1292        <p v-if="councilError" class="set-error px-4 pt-2" data-council-error>{{ councilError }}</p>
1293  
1294        <p v-if="settings.councilMembers.length === 0" class="set-empty" data-council-empty>
1295          No council members yet. A member is a credential, a model and a role — add three or four
1296          plus one arbiter.
1297        </p>
1298  
1299        <ul v-else class="flex flex-col">
1300          <li
1301            v-for="m in settings.councilMembers"
1302            :key="m.id"
1303            class="set-row"
1304            data-council-member-row
1305            :data-council-member-id="m.id"
1306            :data-council-member-available="m.available"
1307          >
1308            <template v-if="renamingMemberId === m.id">
1309              <input
1310                v-model="renameMemberLabel"
1311                class="set-input set-input-sm flex-1"
1312                data-council-rename-input
1313                @keydown.enter="commitRenameMember"
1314                @keydown.esc="renamingMemberId = null"
1315              />
1316              <button class="set-action" data-council-rename-confirm @click="commitRenameMember">
1317                Save
1318              </button>
1319              <button class="set-action" @click="renamingMemberId = null">Cancel</button>
1320            </template>
1321            <template v-else>
1322              <span class="set-row-name" :class="!m.available && 'set-row-dim'">{{ m.label }}</span>
1323              <span class="set-role-chip">{{ m.role }}</span>
1324              <span class="set-row-detail">
1325                {{ m.providerName ?? '—' }}{{ m.credentialLabel ? ' · ' + m.credentialLabel : '' }}
1326              </span>
1327              <!-- ⚠ THE D56 PROOF, RENDERED. A member with no model of its own
1328                   says so and names what it inherits — the two facts stay
1329                   distinguishable, which is what stops the inherited value from
1330                   being "helpfully" written into the row. -->
1331              <span v-if="m.model" class="set-mono" data-council-model-own>{{ m.model }}</span>
1332              <span
1333                v-else-if="m.resolvedModel"
1334                class="set-mono set-mono-inherited"
1335                data-council-model-inherited
1336              >
1337                inherits {{ m.resolvedModel }}
1338              </span>
1339              <span v-else class="set-hint" data-council-model-none>no model</span>
1340              <!-- SHOWN, DISABLED AND EXPLAINED — never hidden. Naming the
1341                   credential BY LABEL ONLY: no URL, no env var, no fragment. -->
1342              <span v-if="!m.available" class="set-row-warn" data-council-unavailable-reason>
1343                ⚠ {{ m.unavailableReason }}
1344              </span>
1345              <span class="flex-1"></span>
1346              <button class="set-action" data-council-rename @click="beginRenameMember(m.id, m.label)">
1347                Rename
1348              </button>
1349              <template v-if="deletingMemberId === m.id">
1350                <span class="set-meta">delete?</span>
1351                <button
1352                  class="set-action set-action-danger"
1353                  data-council-delete-confirm
1354                  @click="confirmDeleteMember(m.id)"
1355                >
1356                  Yes
1357                </button>
1358                <button class="set-action" @click="deletingMemberId = null">No</button>
1359              </template>
1360              <button v-else class="set-action" data-council-delete @click="deletingMemberId = m.id">
1361                Delete
1362              </button>
1363            </template>
1364          </li>
1365        </ul>
1366      </div>
1367  
1368      <span class="flex-1"></span>
1369      <p class="set-foot">
1370        <svg width="9" height="11" viewBox="0 0 9 11" fill="none" stroke="currentColor" stroke-width="1">
1371          <rect x="1" y="4.5" width="7" height="5.5" rx="1" />
1372          <path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" />
1373        </svg>
1374        stored per-credential in the Windows credential vault · export excludes keys
1375      </p>
1376    </div>
1377  </template>
1378  
1379  <style src="../assets/settings.css"></style>
1380  
```

### Exhibit 11 — `src/renderer/src/components/LaunchDialog.vue` (lines 1–1125, 42359 bytes)

```vue
   1  <script setup lang="ts">
   2  import { computed, onMounted, ref, watch } from 'vue'
   3  import type {
   4    AdapterDescriptor,
   5    AgentKind,
   6    AttachResponse,
   7    CredentialProfileMetaWire,
   8    DetectedCli,
   9    EffortLevel,
  10    LaunchProfileWire,
  11    ModelCatalogEntry,
  12    PickableWorktree,
  13    ProviderConfig,
  14    WorkspaceMode
  15  } from '../../../shared/ipc'
  16  
  17  /**
  18   * Launch dialog (Task 1-4): pick an agent + cwd, launch via session:launch.
  19   * Agent cards are capability-driven by cli:detect — an undetected agent is a
  20   * disabled card with a "not found" note, never a hidden or broken option.
  21   * Validation failures ({ok:false}) render inline; the dialog stays open.
  22   *
  23   * Task 2-2 (D22/D26f): the workspace-mode selector. Main computes the default
  24   * (suggestedMode) and the attachable-worktree list on session:launch-context;
  25   * the CHOSEN mode always travels explicitly in the launch payload — main
  26   * validates it, never silently overrides. A non-git project root shows an
  27   * inline "not a git repository" state and offers only current-tree.
  28   *
  29   * Task 3-3 (D34f): cards render from the WIRE — the adapter-supplied
  30   * agentKind/displayName on each cli:detect row. Nothing here hardcodes an
  31   * agent name or label anymore; card ORDER now derives from main's
  32   * DETECTED_TOOLS (the same order the deleted kind-list constant had).
  33   *
  34   * Task 3-6 (spec §8): an auth-method choice. SUBSCRIPTION stays the default
  35   * — a user with no credential profiles sees today's dialog, unchanged; BYOK
  36   * is opt-in. The api_key choice appears only when an ELIGIBLE profile exists
  37   * for the selected agent (its provider's adapter_type matches the agent,
  38   * auth_mode is api_key, and the profile is not marked unavailable).
  39   */
  40  const emit = defineEmits<{
  41    cancel: []
  42    launched: [payload: { agent: AgentKind; snapshot: AttachResponse }]
  43  }>()
  44  
  45  /** The active project's id — threaded into both project-aware IPC calls
  46   *  (Task 1-5: session:launch-context and session:launch resolve it in main). */
  47  const props = defineProps<{ projectId: string }>()
  48  
  49  interface AgentCard {
  50    name: AgentKind
  51    label: string
  52    found: boolean
  53    version: string | null
  54  }
  55  
  56  const panel = ref<HTMLDivElement | null>(null)
  57  const cwdInput = ref<HTMLInputElement | null>(null)
  58  const agents = ref<AgentCard[]>([])
  59  const selected = ref<AgentKind | null>(null)
  60  const cwd = ref('')
  61  const projectRoot = ref('')
  62  const recentCwds = ref<string[]>([])
  63  const repoRoot = ref<string | null>(null)
  64  const mode = ref<WorkspaceMode>('current-tree')
  65  const pickable = ref<PickableWorktree[]>([])
  66  const selectedWorktree = ref<string | null>(null)
  67  const error = ref('')
  68  const busy = ref(false)
  69  
  70  /* 3-6 (spec §8): BYOK auth choice. 'subscription' is the DEFAULT — with no
  71   * credential profiles the dialog behaves exactly as it did before 3-6. */
  72  type AuthChoice = 'subscription' | 'api_key'
  73  const authChoice = ref<AuthChoice>('subscription')
  74  const providers = ref<ProviderConfig[]>([])
  75  const profiles = ref<CredentialProfileMetaWire[]>([])
  76  const selectedProfile = ref<string | null>(null)
  77  
  78  /** Profiles eligible for the SELECTED agent: the profile's provider targets
  79   *  that agent (adapter_type) via an api_key auth mode, and the profile is
  80   *  not marked unavailable (it would refuse at launch anyway; the Settings
  81   *  view is where that state is explained). */
  82  const eligibleProfiles = computed(() => {
  83    if (selected.value === null) return []
  84    const agent = selected.value
  85    return profiles.value.filter((p) => {
  86      const provider = providers.value.find((pr) => pr.id === p.providerId)
  87      return (
  88        provider !== undefined &&
  89        provider.adapter_type === agent &&
  90        provider.auth_mode === 'api_key' &&
  91        p.unavailableSince === null
  92      )
  93    })
  94  })
  95  
  96  /* 3a-4 (PLAN §4): the app-level Fast/Balanced/Deep/Max control, plus the
  97   * missing-model warning beside the resolved model. `effort` is per-launch and
  98   * UNPERSISTED — nothing here writes it anywhere. */
  99  const adapters = ref<AdapterDescriptor[]>([])
 100  const effort = ref<EffortLevel | null>(null)
 101  const catalog = ref<ModelCatalogEntry[]>([])
 102  
 103  /* ── D90: the per-launch model pick ──────────────────────────────────────
 104   *
 105   * ⚠ THIS IS THE ONE THING D81 SAID THIS FILE WOULD NEVER HAVE, so the shape is
 106   * deliberate. D81/D48 refused a FREE-TEXT model field standing beside the
 107   * route's own default — two hand-authored homes for one fact. This is a CLOSED
 108   * pick from a list MAIN owns, `null` means "use whatever main resolves", and
 109   * nothing here re-implements the precedence table: `session:launch` still
 110   * decides, and this only supplies rank 0.
 111   */
 112  const shortlist = ref<string[]>([])
 113  const modelChoice = ref<string | null>(null)
 114  
 115  /**
 116   * ⚠ ABSENT, NOT DISABLED. When the selected adapter declares no effort
 117   * descriptor the control DOES NOT RENDER — no greyed slider, and no
 118   * explanatory text in its place either; absence is the message. PLAN §4
 119   * ("LaunchDialog renders only what the selected adapter's capabilities allow")
 120   * and Task 3-4's standing bar on dead UI.
 121   *
 122   * The levels AND their labels come from the descriptor, via adapter:list —
 123   * there are no hardcoded 'Fast'/'Deep' strings driving choices in this file.
 124   */
 125  const effortLevels = computed(
 126    () => adapters.value.find((a) => a.id === selected.value)?.capabilities.reasoningEffort?.levels ?? []
 127  )
 128  
 129  /* 3a-5 (D43): the saved-profile picker.
 130   *
 131   * ⚠ NAME CARE. `selectedProfile` above already means the CREDENTIAL profile
 132   * (3-6). This is the LAUNCH profile, and the two are different things — hence
 133   * the longer name rather than a one-character difference in the same file. */
 134  const launchProfiles = ref<LaunchProfileWire[]>([])
 135  const selectedLaunchProfileId = ref<string | null>(null)
 136  
 137  const selectedLaunchProfile = computed<LaunchProfileWire | null>(
 138    () => launchProfiles.value.find((p) => p.id === selectedLaunchProfileId.value) ?? null
 139  )
 140  
 141  /** Save-as-profile, offered after a successful launch. */
 142  const saveLabel = ref('')
 143  const saveError = ref('')
 144  const savedOk = ref(false)
 145  
 146  /**
 147   * The model precedence order, RESOLVED IN MAIN and merely displayed here.
 148   *
 149   * Rank 1 is the chosen launch profile's resolved model (main already applied
 150   * profile -> route -> null); rank 2 is the bare route default for a launch with
 151   * no profile. The renderer does NOT re-implement the table — that would be the
 152   * second home 3a-4's ruling exists to prevent.
 153   */
 154  const resolvedModel = computed<string | null>(() => {
 155    if (selectedLaunchProfile.value !== null) return selectedLaunchProfile.value.model
 156    if (authChoice.value !== 'api_key' || selectedProfile.value === null) return null
 157    const profile = profiles.value.find((p) => p.id === selectedProfile.value)
 158    if (!profile) return null
 159    return providers.value.find((pr) => pr.id === profile.providerId)?.model ?? null
 160  })
 161  
 162  /**
 163   * D90: the model this launch will ACTUALLY run on — the per-launch pick when
 164   * there is one, otherwise whatever main resolved. Everything user-facing below
 165   * (the Model field, the missing-model warning) reads THIS rather than
 166   * `resolvedModel`, so the dialog never shows one model while sending another.
 167   */
 168  const effectiveModel = computed<string | null>(() => modelChoice.value ?? resolvedModel.value)
 169  
 170  /**
 171   * D90 / D85: what the dropdown offers — THE SHORTLIST FIRST, the full catalog
 172   * as the fallback (Matthew's call, 2026-07-28).
 173   *
 174   * ⚠ THE ORDER IS NOT ALPHABETISED AND MUST NOT BE. `model_shortlist` is
 175   * returned in the order the user built it (storage.ts is explicit that "a
 176   * personal shortlist carries information in its order"); re-sorting it here
 177   * would throw that away. The catalog fallback arrives in main's order for the
 178   * same reason.
 179   */
 180  const modelOptions = computed<string[]>(() =>
 181    shortlist.value.length > 0 ? shortlist.value : catalog.value.map((m) => m.modelId)
 182  )
 183  
 184  /** ⚠ Only a model that WAS catalogued and then disappeared earns a warning
 185   *  (worked example 8). An id the catalog has never seen produces none
 186   *  (worked example 11) — a warning that fires on the normal case is a warning
 187   *  nobody reads. The launch is never blocked either way. */
 188  const missingModelRow = computed<ModelCatalogEntry | null>(() => {
 189    const model = effectiveModel.value
 190    if (model === null) return null
 191    const row = catalog.value.find((m) => m.modelId === model)
 192    return row && row.missingSince !== null ? row : null
 193  })
 194  
 195  // Agent switches recompute eligibility: an api_key choice with no eligible
 196  // profiles falls back to subscription, and the chosen profile is re-anchored
 197  // to the new list. Choosing api_key defaults to the first eligible profile.
 198  watch([selected, authChoice], () => {
 199    if (authChoice.value === 'api_key' && eligibleProfiles.value.length === 0) {
 200      authChoice.value = 'subscription'
 201    }
 202    if (!eligibleProfiles.value.some((p) => p.id === selectedProfile.value)) {
 203      selectedProfile.value = eligibleProfiles.value[0]?.id ?? null
 204    }
 205    // A level chosen for one adapter is meaningless on another.
 206    if (effort.value !== null && !effortLevels.value.some((l) => l.id === effort.value)) {
 207      effort.value = null
 208    }
 209  })
 210  
 211  /**
 212   * Load the CACHED catalog for the chosen profile's provider so the
 213   * missing-model warning can render BEFORE a launch is spent rather than after.
 214   *
 215   * ⚠ This is `listModels` — a PURE READ that makes no network call and
 216   * decrypts nothing. `refreshModels`, the live key-bearing call, is NOT
 217   * reachable from this component at all: it lives behind the Settings card's
 218   * Refresh button and nowhere else.
 219   */
 220  watch(selectedProfile, async (id) => {
 221    catalog.value = []
 222    // D90: a model chosen for one route is meaningless on another — clear the
 223    // pick with the list it came from, never carry it across.
 224    shortlist.value = []
 225    modelChoice.value = null
 226    if (id === null) return
 227    const profile = profiles.value.find((p) => p.id === id)
 228    if (!profile) return
 229    const res = await window.chorus.listModels(profile.providerId)
 230    // Re-check: the selection may have moved while this was in flight.
 231    if (selectedProfile.value === id) {
 232      catalog.value = res.models
 233      shortlist.value = res.shortlist
 234    }
 235  })
 236  
 237  /**
 238   * Picking a launch profile PREFILLS agent, workspace mode, credential and
 239   * effort — and the user may override any of them before launching. The profile
 240   * is a DEFAULT, not a lock.
 241   *
 242   * ⚠ Selecting NOTHING is first-class: a dialog with no saved profiles behaves
 243   * exactly as it did before this task (the 3-6 discipline — no visible change
 244   * unless you use the feature).
 245   */
 246  watch(selectedLaunchProfileId, async (id) => {
 247    const profile = launchProfiles.value.find((p) => p.id === id)
 248    if (!profile) return
 249    selected.value = profile.agent
 250    mode.value = profile.workspace_mode
 251    if (profile.credential_profile_id) {
 252      authChoice.value = 'api_key'
 253      selectedProfile.value = profile.credential_profile_id
 254    } else {
 255      authChoice.value = 'subscription'
 256    }
 257    // 3a-4's absent-not-disabled rule is unchanged: if the adapter declares no
 258    // effort axis the control does not render, and a stored level is simply not
 259    // offered — never greyed out.
 260    effort.value = profile.effort
 261    // The catalog for the missing-model warning, keyed on the profile's route.
 262    catalog.value = []
 263    shortlist.value = []
 264    // D90: the profile's own model is rank 1 and main applies it; the dialog's
 265    // rank-0 pick starts empty so picking a profile does not silently override
 266    // the very model that profile names.
 267    modelChoice.value = null
 268    if (profile.provider_id) {
 269      const res = await window.chorus.listModels(profile.provider_id)
 270      if (selectedLaunchProfileId.value === id) {
 271        catalog.value = res.models
 272        shortlist.value = res.shortlist
 273      }
 274    }
 275  })
 276  
 277  onMounted(async () => {
 278    const [clis, ctx, providerRows, profileRows, adapterRows] = await Promise.all([
 279      window.chorus.detectClis(),
 280      window.chorus.getLaunchContext(props.projectId),
 281      window.chorus.listProviders(),
 282      window.chorus.listCredentials(),
 283      window.chorus.listAdapters()
 284    ])
 285    adapters.value = adapterRows
 286    agents.value = clis
 287      .filter((c): c is DetectedCli & { agentKind: AgentKind } => c.agentKind !== null)
 288      .map((c) => ({
 289        name: c.agentKind,
 290        label: c.displayName ?? c.agentKind,
 291        found: c.found,
 292        version: c.version
 293      }))
 294    projectRoot.value = ctx.projectRoot
 295    recentCwds.value = ctx.recentCwds
 296    cwd.value = ctx.projectRoot
 297    // 2-2: main's suggestion is the default; the user may override it freely.
 298    repoRoot.value = ctx.repoRoot
 299    mode.value = ctx.suggestedMode
 300    pickable.value = ctx.worktrees
 301    selectedWorktree.value = ctx.worktrees[0]?.id ?? null
 302    providers.value = providerRows
 303    profiles.value = profileRows
 304    selected.value = agents.value.find((a) => a.found)?.name ?? null
 305    // 3a-5: the picker rows and the per-project last-used pointer ride in on the
 306    // launch context — no fifth round trip. Both are computed in MAIN; a
 307    // DANGLING pointer already arrived as null, so there is nothing to resolve
 308    // here and no default for the renderer to invent.
 309    launchProfiles.value = ctx.launchProfiles
 310    selectedLaunchProfileId.value = ctx.lastLaunchProfileId
 311    cwdInput.value?.focus()
 312  })
 313  
 314  function cancel(): void {
 315    emit('cancel')
 316  }
 317  
 318  /**
 319   * The design's two-letter agent tile (3c-4). ⚠ This is a GLYPH, not a name:
 320   * the file's standing rule since 3-3/D34f is that nothing here hardcodes an
 321   * agent's name or label — those still come from the wire (`displayName`), and
 322   * card ORDER still comes from main's DETECTED_TOOLS. D38's system vocabulary is
 323   * "agent identity by glyph only, never colour", and this is that glyph, keyed
 324   * by the closed AgentKind union so a new adapter fails the typecheck rather
 325   * than rendering blank.
 326   */
 327  const codes: Record<AgentKind, string> = {
 328    claude: 'cc',
 329    codex: 'cx',
 330    kimi: 'km',
 331    opencode: 'oc' // D90
 332  } // D86
 333  
 334  /** The three workspace modes as CARDS (the mock's anatomy) rather than the
 335   *  three buttons 3c-4 replaced. Order and labels are unchanged from what the
 336   *  buttons rendered; the list is a const so the template needs no type cast. */
 337  const MODES: readonly WorkspaceMode[] = ['current-tree', 'new-worktree', 'existing-worktree']
 338  
 339  const modeLabels: Record<WorkspaceMode, string> = {
 340    'current-tree': 'Current tree',
 341    'new-worktree': 'New worktree',
 342    'existing-worktree': 'Existing worktree'
 343  }
 344  
 345  /** Static descriptors for the three workspace modes — the mock gives each card
 346   *  a sub-line. These are DESCRIPTIVE COPY, not data: the mock's own sub-line
 347   *  for new-worktree is a branch name main has not generated yet at dialog time,
 348   *  so it is not reproduced (D76 — never render a value the app cannot know). */
 349  const modeNotes: Record<WorkspaceMode, string> = {
 350    'current-tree': 'works in place',
 351    'new-worktree': 'fresh branch',
 352    'existing-worktree': 'attach a kept one'
 353  }
 354  
 355  /** The route backing the current credential choice, for the save default. */
 356  const currentProviderName = computed<string | null>(() => {
 357    if (authChoice.value !== 'api_key' || selectedProfile.value === null) return null
 358    const profile = profiles.value.find((p) => p.id === selectedProfile.value)
 359    if (!profile) return null
 360    return providers.value.find((pr) => pr.id === profile.providerId)?.name ?? null
 361  })
 362  
 363  /**
 364   * D43: the default label is `<provider name>/<model>`, and it is a DEFAULT the
 365   * user immediately owns — never a key. A route-less profile names the agent.
 366   * (Main's `defaultProfileLabel` is the same rule; this is the prefill, and main
 367   * validates whatever actually arrives.)
 368   */
 369  function prefillSaveLabel(): void {
 370    saveError.value = ''
 371    savedOk.value = false
 372    const left = currentProviderName.value ?? selected.value ?? ''
 373    saveLabel.value = resolvedModel.value ? `${left}/${resolvedModel.value}` : left
 374  }
 375  
 376  /**
 377   * Save the configuration currently in the dialog as a launch profile.
 378   *
 379   * ⚠ `existing-worktree` is never saved: a saved profile may not pin a transient
 380   * worktree row, so the stored mode falls back to current-tree and main refuses
 381   * anything else. The user picks a worktree at launch, which is the point.
 382   */
 383  async function saveAsProfile(): Promise<void> {
 384    if (!selected.value || busy.value) return
 385    saveError.value = ''
 386    savedOk.value = false
 387    const credentialId =
 388      authChoice.value === 'api_key' && selectedProfile.value ? selectedProfile.value : null
 389    const providerId = credentialId
 390      ? (profiles.value.find((p) => p.id === credentialId)?.providerId ?? null)
 391      : null
 392    // D14: a fresh literal of primitives. Nothing store-sourced crosses.
 393    const res = await window.chorus.createLaunchProfile({
 394      label: saveLabel.value.trim(),
 395      agent: selected.value,
 396      provider_id: providerId,
 397      credential_profile_id: credentialId,
 398      // ⚠ NULL, not the resolved value. Storing the route's default here would
 399      // COPY rank 2 into rank 1 and create the second home for "which model"
 400      // that D48 exists to prevent. A null model inherits the route default at
 401      // resolve time, every time.
 402      model: null,
 403      effort: effort.value,
 404      permission_mode: null,
 405      workspace_mode: mode.value === 'new-worktree' ? 'new-worktree' : 'current-tree',
 406      env_json: null
 407    })
 408    if (!res.ok) {
 409      saveError.value = res.reason
 410      return
 411    }
 412    savedOk.value = true
 413    launchProfiles.value = [...launchProfiles.value, res.profile].sort((a, b) =>
 414      a.label.localeCompare(b.label)
 415    )
 416    selectedLaunchProfileId.value = res.profile.id
 417  }
 418  
 419  async function submit(): Promise<void> {
 420    if (!selected.value || !cwd.value || busy.value) return
 421    if (mode.value === 'existing-worktree' && !selectedWorktree.value) return
 422    busy.value = true
 423    error.value = ''
 424    try {
 425      // D14: a fresh literal of primitives — nothing store-sourced crosses.
 426      // The mode ALWAYS travels explicitly; worktree_id rides along only for
 427      // existing-worktree (main ignores it otherwise).
 428      // 3-6: credential_profile_id rides along only for the api_key choice.
 429      // The dialog sends a PROFILE ID, never a key — it structurally CANNOT
 430      // obtain one (3-2's write-only IPC has no read path), so there is
 431      // nothing here to "pre-validate" a key with; the probe lives in main.
 432      const res = await window.chorus.launch({
 433        project_id: props.projectId,
 434        agent: selected.value,
 435        cwd: cwd.value,
 436        workspace_mode: mode.value,
 437        ...(mode.value === 'existing-worktree' && selectedWorktree.value
 438          ? { worktree_id: selectedWorktree.value }
 439          : {}),
 440        // 3a-5: a launch profile and a bare credential are MUTUALLY EXCLUSIVE —
 441        // main authors that refusal, and the dialog simply never sends both.
 442        // ⚠ A STRING PRIMITIVE, never a spread profile object: a Pinia/reactive
 443        // object is a Vue Proxy and structured clone rejects it with NO
 444        // compile-time signal (D14).
 445        ...(selectedLaunchProfileId.value
 446          ? { launch_profile_id: selectedLaunchProfileId.value }
 447          : authChoice.value === 'api_key' && selectedProfile.value
 448            ? { credential_profile_id: selectedProfile.value }
 449            : {}),
 450        // 3a-4: omitted entirely when nothing was chosen, which is what makes a
 451        // no-effort launch byte-identical to a pre-3a-4 one. 3a-5 prefills this
 452        // SAME field from the profile — there is no second effort field.
 453        ...(effort.value !== null ? { effort: effort.value } : {}),
 454        // D90: rank 0. A STRING PRIMITIVE, and omitted entirely when the user
 455        // left the pick on "route default" — same discipline as `effort` above,
 456        // and the reason an untouched dialog still sends a pre-D90 payload.
 457        ...(modelChoice.value !== null ? { model: modelChoice.value } : {})
 458      })
 459      if ('ok' in res) {
 460        error.value = res.reason
 461        return
 462      }
 463      emit('launched', { agent: selected.value, snapshot: res })
 464    } catch (e) {
 465      // Rejected invoke (e.g. spawn failure in main) — same inline treatment.
 466      error.value = e instanceof Error ? e.message : String(e)
 467    } finally {
 468      busy.value = false
 469    }
 470  }
 471  
 472  /** Basic focus trap: Tab/Shift-Tab cycle within the panel; Esc cancels. */
 473  function onKeydown(e: KeyboardEvent): void {
 474    if (e.key === 'Escape') {
 475      cancel()
 476      return
 477    }
 478    if (e.key !== 'Tab' || !panel.value) return
 479    const focusables = Array.from(
 480      panel.value.querySelectorAll<HTMLElement>(
 481        'button:not([disabled]), input:not([disabled]), select:not([disabled])'
 482      )
 483    )
 484    if (focusables.length === 0) return
 485    const first = focusables[0]
 486    const last = focusables[focusables.length - 1]
 487    const active = document.activeElement
 488    if (e.shiftKey && active === first) {
 489      last.focus()
 490      e.preventDefault()
 491    } else if (!e.shiftKey && active === last) {
 492      first.focus()
 493      e.preventDefault()
 494    }
 495  }
 496  </script>
 497  
 498  <template>
 499    <div class="overlay-scrim overlay-scrim-dialog" @keydown="onKeydown">
 500      <div
 501        ref="panel"
 502        class="overlay-panel overlay-panel-dialog launch"
 503        role="dialog"
 504        aria-modal="true"
 505      >
 506        <!-- ⚠ The mock's header also carries a project chip ("■ TaxApp"). This
 507             dialog receives a projectId and a projectRoot but never the project's
 508             NAME, and deriving it from the root's basename would be a guess that
 509             goes wrong the moment a project is renamed — omitted rather than
 510             approximated (D76's rule applied to a label). Esc IS bound
 511             (onKeydown), so its keycap is honest and stays. -->
 512        <div class="overlay-header launch-head">
 513          <span class="launch-title">New session</span>
 514          <span class="overlay-keycap">esc</span>
 515        </div>
 516  
 517        <div class="overlay-body launch-body">
 518  
 519        <!-- 3a-5 (D43): the saved-profile picker. Rendered ONLY when profiles
 520             exist — with none, this dialog is byte-for-byte the pre-3a-5 dialog
 521             (the 3-6 discipline: no visible change unless you use the feature).
 522  
 523             ⚠ AN UNLAUNCHABLE PROFILE IS SHOWN, DISABLED AND EXPLAINED — never
 524             filtered out. A launch profile is a row the USER NAMED, so a named
 525             entry that silently vanishes is worse than one that says why it
 526             cannot launch. (Deliberately unlike the credential picker below,
 527             whose eligibleProfiles DOES hide unavailable rows — those are
 528             plumbing, not user-named rows.) -->
 529        <template v-if="launchProfiles.length > 0">
 530          <div class="launch-profiles">
 531            <span class="overlay-eyebrow">PROFILES</span>
 532            <div class="launch-chips">
 533              <button
 534                type="button"
 535                class="launch-chip"
 536                :class="{ 'launch-chip-on': selectedLaunchProfileId === null }"
 537                @click="selectedLaunchProfileId = null"
 538              >
 539                No profile
 540              </button>
 541              <button
 542                v-for="p in launchProfiles"
 543                :key="p.id"
 544                type="button"
 545                class="launch-chip"
 546                :class="{ 'launch-chip-on': selectedLaunchProfileId === p.id }"
 547                :disabled="p.disabled_reason !== null"
 548                :title="p.disabled_reason ?? undefined"
 549                @click="selectedLaunchProfileId = p.id"
 550              >
 551                {{ p.label }}{{ p.disabled_reason ? ' — unavailable' : '' }}
 552              </button>
 553            </div>
 554          </div>
 555          <p v-if="selectedLaunchProfile?.disabled_reason" class="launch-warn">
 556            {{ selectedLaunchProfile.disabled_reason }}
 557          </p>
 558        </template>
 559  
 560        <!-- agent cards from cli:detect -->
 561        <div class="launch-section">
 562          <span class="overlay-label">Agent</span>
 563          <div class="launch-grid">
 564            <button
 565              v-for="a in agents"
 566              :key="a.name"
 567              type="button"
 568              class="overlay-card launch-agent"
 569              :class="{ 'overlay-card-selected': selected === a.name }"
 570              :disabled="!a.found"
 571              @click="selected = a.name"
 572            >
 573              <span class="launch-agent-tile">{{ codes[a.name] }}</span>
 574              <span class="launch-agent-text">
 575                <span class="launch-agent-name">{{ a.label }}</span>
 576                <span class="launch-agent-ver" :class="{ 'launch-agent-found': a.found }">
 577                  {{ a.found ? a.version : 'not found' }}
 578                </span>
 579              </span>
 580            </button>
 581          </div>
 582        </div>
 583  
 584        <!-- auth method (3-6 / spec §8): subscription is the default and the
 585             api_key choice appears ONLY when an eligible credential profile
 586             exists for the selected agent — BYOK is opt-in. -->
 587        <div class="launch-row">
 588          <div class="launch-section">
 589            <span class="overlay-label">Auth</span>
 590            <div class="overlay-segmented">
 591              <button
 592                type="button"
 593                class="overlay-segment"
 594                :class="{ 'overlay-segment-alt-on': authChoice === 'subscription' }"
 595                @click="authChoice = 'subscription'"
 596              >
 597                subscription
 598              </button>
 599              <button
 600                v-if="eligibleProfiles.length > 0"
 601                type="button"
 602                class="overlay-segment"
 603                :class="{ 'overlay-segment-alt-on': authChoice === 'api_key' }"
 604                @click="authChoice = 'api_key'"
 605              >
 606                api key
 607              </button>
 608            </div>
 609          </div>
 610  
 611          <!-- ⚠ D81 IS REVISED HERE BY D90, AND ONLY THIS FAR. D81 said this
 612               dialog has no model input, because D48 refused a FREE-TEXT field
 613               standing beside the route's own default. What follows is not that:
 614               it is a CLOSED <select> over a list MAIN owns (`model_shortlist`,
 615               then `model_catalog` — D85), whose empty value means "whatever main
 616               resolves". No precedence table is re-implemented here; the dialog
 617               supplies rank 0 and `session:launch` still decides.
 618  
 619               ⚠ AND IT IS STILL A <select>, NOT AN <input list>. ImplementationSpec
 620               -3c-4 §3/§6.3 once asked for "an <input> with a <datalist>"; D81
 621               struck that check and it stays struck — a free-text box is exactly
 622               what D48 refused, and the shortlist is the answer to "but what if my
 623               model isn't listed" (it is user-authored and accepts uncatalogued
 624               ids by design).
 625  
 626               Falls back to the display-only field when the route offers no list,
 627               and is absent entirely when nothing resolves — the same
 628               absent-not-disabled discipline the effort control uses. -->
 629          <div v-if="effectiveModel || modelOptions.length > 0" class="launch-section">
 630            <span class="overlay-label">Model</span>
 631            <select
 632              v-if="modelOptions.length > 0"
 633              v-model="modelChoice"
 634              class="launch-select"
 635              data-launch-model
 636            >
 637              <!-- ⚠ The null option is FIRST and is the default. A launch that
 638                   touches nothing here is byte-identical to a pre-D90 launch,
 639                   which is what makes this additive rather than a behaviour
 640                   change for every existing route. -->
 641              <option :value="null">
 642                {{ resolvedModel ? `Route default — ${resolvedModel}` : 'CLI default' }}
 643              </option>
 644              <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
 645            </select>
 646            <div v-else class="overlay-field launch-model">
 647              <svg
 648                width="10"
 649                height="10"
 650                viewBox="0 0 10 10"
 651                fill="none"
 652                stroke="currentColor"
 653                stroke-width="1.2"
 654                aria-hidden="true"
 655              >
 656                <circle cx="4.2" cy="4.2" r="3" />
 657                <path d="M6.5 6.5 9 9" />
 658              </svg>
 659              <span class="launch-model-id">{{ effectiveModel }}</span>
 660            </div>
 661          </div>
 662        </div>
 663  
 664        <select
 665          v-if="authChoice === 'api_key'"
 666          v-model="selectedProfile"
 667          class="launch-select"
 668        >
 669          <option v-for="p in eligibleProfiles" :key="p.id" :value="p.id">{{ p.label }}</option>
 670        </select>
 671  
 672        <!-- 3a-4 (worked example 8): the resolved model, and — only when the
 673             catalog SAW it and then stopped seeing it — the warning, met here
 674             BEFORE a launch is spent rather than at the provider afterwards.
 675             The launch is NOT blocked and nothing is substituted.
 676             ⚠ Wording unchanged by 3c-4; only its colour is now a token. -->
 677        <p v-if="missingModelRow" class="launch-warn" data-launch-missing-model>
 678          ⚠ <span class="launch-mono">{{ effectiveModel }}</span> was not in the last model refresh ({{
 679            missingModelRow.missingSince!.slice(0, 10)
 680          }}). It may have been retired — this launch will fail at the provider.
 681        </p>
 682  
 683        <!-- 3a-4 effort (PLAN §4): rendered ONLY when the selected adapter
 684             declares a descriptor. Absent, not disabled — and no explanatory
 685             text in its place either. Labels come from the descriptor via
 686             adapter:list; nothing here hardcodes a level name. -->
 687        <div v-if="effortLevels.length > 0" class="launch-section">
 688          <span class="overlay-label">Effort</span>
 689          <div class="overlay-segmented">
 690            <button
 691              v-for="l in effortLevels"
 692              :key="l.id"
 693              type="button"
 694              class="overlay-segment"
 695              :class="{ 'overlay-segment-on': effort === l.id }"
 696              :title="l.args.join(' ')"
 697              data-launch-effort
 698              @click="effort = effort === l.id ? null : l.id"
 699            >
 700              {{ l.label }}
 701            </button>
 702          </div>
 703          <!-- A COLLAPSED mapping (two levels resolving to the same adapter
 704               value) is legal, and this is what makes it visible rather than
 705               misleading: the resolved tokens are shown, from the descriptor. -->
 706          <p v-if="effort !== null" class="launch-args">
 707            {{ effortLevels.find((l) => l.id === effort)?.args.join(' ') }}
 708          </p>
 709        </div>
 710  
 711        <!-- workspace mode (2-2 / D22): a non-git project root offers only
 712             current-tree, with the inline note (findings risk 3). -->
 713        <div class="launch-section">
 714          <span class="overlay-label">Workspace</span>
 715          <div v-if="repoRoot === null" class="overlay-note">
 716            Not a git repository — launching in the current working tree.
 717          </div>
 718          <div v-else class="launch-grid launch-grid-3">
 719            <button
 720              v-for="m in MODES"
 721              :key="m"
 722              type="button"
 723              class="overlay-card"
 724              :class="{ 'overlay-card-selected': mode === m }"
 725              :disabled="m === 'existing-worktree' && pickable.length === 0"
 726              :title="
 727                m === 'existing-worktree'
 728                  ? 'Attach to a worktree an earlier session left behind'
 729                  : undefined
 730              "
 731              @click="mode = m"
 732            >
 733              <span class="launch-mode-name">{{ modeLabels[m] }}</span>
 734              <span class="launch-mode-note">{{ modeNotes[m] }}</span>
 735            </button>
 736          </div>
 737          <select
 738            v-if="mode === 'existing-worktree' && repoRoot !== null"
 739            v-model="selectedWorktree"
 740            class="launch-select"
 741          >
 742            <option v-for="w in pickable" :key="w.id" :value="w.id">
 743              {{ w.branch }} — {{ w.path }}
 744            </option>
 745          </select>
 746        </div>
 747  
 748        <!-- cwd -->
 749        <div class="launch-section">
 750          <span class="overlay-label">Working directory</span>
 751          <div class="overlay-field">
 752            <input
 753              ref="cwdInput"
 754              v-model="cwd"
 755              class="launch-cwd"
 756              @keydown.enter="submit"
 757            />
 758          </div>
 759          <div class="launch-recents">
 760            <button type="button" class="launch-recent launch-recent-root" @click="cwd = projectRoot">
 761              use project root
 762            </button>
 763            <button
 764              v-for="r in recentCwds"
 765              :key="r"
 766              type="button"
 767              class="launch-recent"
 768              :title="r"
 769              @click="cwd = r"
 770            >
 771              {{ r }}
 772            </button>
 773          </div>
 774        </div>
 775  
 776        <p v-if="error" class="overlay-error">{{ error }}</p>
 777  
 778        <!-- 3a-5 (D43): save THIS configuration as a reusable profile. Offered
 779             only when the launch did not already come from one — re-saving a
 780             profile is a rename, and renaming lives in Settings. -->
 781        <template v-if="selectedLaunchProfileId === null && selected">
 782          <div v-if="saveLabel === ''" class="launch-section">
 783            <button type="button" class="launch-link" data-save-as-profile @click="prefillSaveLabel">
 784              Save as launch profile…
 785            </button>
 786          </div>
 787          <div v-else class="launch-section">
 788            <span class="overlay-label">Profile name</span>
 789            <div class="launch-save-row">
 790              <div class="overlay-field">
 791                <input v-model="saveLabel" class="launch-cwd" data-save-label />
 792              </div>
 793              <button
 794                type="button"
 795                class="overlay-btn-ghost"
 796                :disabled="saveLabel.trim() === ''"
 797                data-save-confirm
 798                @click="saveAsProfile"
 799              >
 800                Save
 801              </button>
 802            </div>
 803            <p v-if="saveError" class="overlay-error">{{ saveError }}</p>
 804            <p v-if="savedOk" class="launch-saved">Saved.</p>
 805          </div>
 806        </template>
 807        </div>
 808  
 809        <!-- ⚠ The mock's footer also prints an estimated cost per task
 810             ("est. ~$0.40–0.90 / task at deep"). Chorus has no cost ESTIMATOR —
 811             attribution is account-scoped and after the fact (F35) — so D76 omits
 812             it rather than inventing a range. The mock's `ctrl+↵` keycap on
 813             Launch is omitted for the same family of reason: no such binding
 814             exists, and a keycap for a shortcut that does nothing is a false
 815             statement about the app. -->
 816        <div class="overlay-footer launch-foot">
 817          <span class="launch-foot-spacer" />
 818          <button type="button" class="overlay-btn-ghost" @click="cancel">Cancel</button>
 819          <button
 820            type="button"
 821            class="overlay-btn-primary"
 822            :disabled="!selected || !cwd || busy || (mode === 'existing-worktree' && !selectedWorktree)"
 823            @click="submit"
 824          >
 825            Launch
 826          </button>
 827        </div>
 828      </div>
 829    </div>
 830  </template>
 831  
 832  <style src="../assets/overlays.css"></style>
 833  
 834  <style scoped>
 835  /* Geometry from docs/design/v2/Chorus Launch Dialog.dc.html (D73). The shared
 836     anatomy — scrim, panel, header/footer rules, fields, cards, segmented
 837     controls, buttons — lives in overlays.css above. */
 838  .launch {
 839    width: 640px;
 840  }
 841  
 842  .launch-head {
 843    padding: 13px 18px;
 844  }
 845  
 846  .launch-title {
 847    flex: 1;
 848    min-width: 0;
 849    font-size: 14px;
 850    font-weight: 600;
 851    color: var(--color-text-primary);
 852  }
 853  
 854  .launch-body {
 855    display: flex;
 856    flex-direction: column;
 857    gap: 13px;
 858    padding: 14px 18px 16px;
 859  }
 860  
 861  .launch-section {
 862    display: flex;
 863    flex-direction: column;
 864    gap: 6px;
 865  }
 866  
 867  /* The mock pairs auth/model and effort/runtime as two-column rows. Chorus has
 868     no runtime (native/wsl) concept, so only the first pair is reproduced. */
 869  .launch-row {
 870    display: grid;
 871    grid-template-columns: 220px 1fr;
 872    gap: 10px;
 873    align-items: end;
 874  }
 875  
 876  .launch-grid {
 877    display: grid;
 878    grid-template-columns: 1fr 1fr;
 879    gap: 6px;
 880  }
 881  
 882  .launch-grid-3 {
 883    grid-template-columns: 1fr 1fr 1fr;
 884  }
 885  
 886  /* ── Profile chips ─────────────────────────────────────────────────────── */
 887  .launch-profiles {
 888    display: flex;
 889    align-items: center;
 890    gap: 8px;
 891    padding: 12px 18px 0;
 892  }
 893  
 894  .launch-chips {
 895    display: flex;
 896    gap: 6px;
 897    flex-wrap: wrap;
 898  }
 899  
 900  .launch-chip {
 901    font-family: var(--font-mono);
 902    font-size: 11px;
 903    color: var(--color-text-secondary);
 904    border: 1px solid var(--color-border-badge);
 905    background: var(--color-surface-field);
 906    border-radius: 99px;
 907    padding: 3px 11px;
 908    cursor: default;
 909  }
 910  
 911  .launch-chip:hover:not(:disabled):not(.launch-chip-on) {
 912    border-color: var(--color-logo-bar-low);
 913    color: var(--color-text-body);
 914  }
 915  
 916  .launch-chip-on {
 917    color: var(--color-accent-jade);
 918    border-color: color-mix(in srgb, var(--color-accent-jade) 40%, transparent);
 919    background: color-mix(in srgb, var(--color-accent-jade) 7%, transparent);
 920  }
 921  
 922  .launch-chip:disabled {
 923    opacity: 0.5;
 924    cursor: not-allowed;
 925  }
 926  
 927  /* ── Agent cards ───────────────────────────────────────────────────────── */
 928  .launch-agent {
 929    display: flex;
 930    align-items: center;
 931    gap: 8px;
 932  }
 933  
 934  .launch-agent-tile {
 935    width: 18px;
 936    height: 18px;
 937    flex: none;
 938    display: flex;
 939    align-items: center;
 940    justify-content: center;
 941    border-radius: var(--radius-chip);
 942    background: var(--color-surface-badge);
 943    border: 1px solid var(--color-border-badge);
 944    font-family: var(--font-mono);
 945    font-size: 9px;
 946    color: var(--color-text-badge);
 947  }
 948  
 949  .launch-agent-text {
 950    min-width: 0;
 951    display: flex;
 952    flex-direction: column;
 953  }
 954  
 955  .launch-agent-name {
 956    font-size: 12px;
 957    font-weight: 500;
 958    color: var(--color-text-body);
 959    white-space: nowrap;
 960    overflow: hidden;
 961    text-overflow: ellipsis;
 962  }
 963  
 964  .overlay-card-selected .launch-agent-name {
 965    font-weight: 600;
 966    color: var(--color-text-primary);
 967  }
 968  
 969  .launch-agent-ver {
 970    font-family: var(--font-mono);
 971    font-size: 9px;
 972    color: var(--color-text-quiet);
 973  }
 974  
 975  /* A detected version is the mock's jade "vX detected" line. */
 976  .overlay-card-selected .launch-agent-found {
 977    color: var(--color-accent-jade);
 978  }
 979  
 980  /* ── Model (display only — D81) ────────────────────────────────────────── */
 981  .launch-model {
 982    color: var(--color-text-quiet);
 983  }
 984  
 985  .launch-model-id {
 986    flex: 1;
 987    min-width: 0;
 988    color: var(--color-text-primary);
 989    white-space: nowrap;
 990    overflow: hidden;
 991    text-overflow: ellipsis;
 992  }
 993  
 994  /* ── Workspace mode cards ──────────────────────────────────────────────── */
 995  .launch-mode-name {
 996    display: block;
 997    font-size: 12px;
 998    font-weight: 500;
 999    color: var(--color-text-body);
1000  }
1001  
1002  .overlay-card-selected .launch-mode-name {
1003    font-weight: 600;
1004    color: var(--color-text-primary);
1005  }
1006  
1007  .launch-mode-note {
1008    display: block;
1009    margin-top: 2px;
1010    font-family: var(--font-mono);
1011    font-size: 9px;
1012    color: var(--color-text-quiet);
1013  }
1014  
1015  .overlay-card-selected .launch-mode-note {
1016    color: var(--color-accent-jade);
1017  }
1018  
1019  /* ── Inputs ────────────────────────────────────────────────────────────── */
1020  .launch-cwd {
1021    flex: 1;
1022    min-width: 0;
1023    border: 0;
1024    background: transparent;
1025    outline: none;
1026    font-family: var(--font-mono);
1027    font-size: 11.5px;
1028    color: var(--color-text-body);
1029  }
1030  
1031  .launch-select {
1032    width: 100%;
1033    border: 1px solid var(--color-border-badge);
1034    background: var(--color-surface-field);
1035    border-radius: var(--radius-rail);
1036    padding: 7px 10px;
1037    font-family: var(--font-mono);
1038    font-size: 11.5px;
1039    color: var(--color-text-body);
1040  }
1041  
1042  .launch-recents {
1043    display: flex;
1044    flex-wrap: wrap;
1045    gap: 8px;
1046  }
1047  
1048  .launch-recent {
1049    border: 0;
1050    background: transparent;
1051    padding: 0;
1052    font-family: var(--font-mono);
1053    font-size: 9.5px;
1054    color: var(--color-text-eyebrow);
1055    cursor: default;
1056    max-width: 14rem;
1057    white-space: nowrap;
1058    overflow: hidden;
1059    text-overflow: ellipsis;
1060  }
1061  
1062  .launch-recent:hover {
1063    color: var(--color-text-quiet);
1064  }
1065  
1066  .launch-recent-root {
1067    color: var(--color-accent-jade);
1068  }
1069  
1070  .launch-recent-root:hover {
1071    color: var(--color-accent-jade-hover);
1072  }
1073  
1074  /* ── Messages ──────────────────────────────────────────────────────────── */
1075  .launch-warn {
1076    font-size: 11px;
1077    line-height: 1.45;
1078    color: var(--color-state-attention-text);
1079  }
1080  
1081  .launch-mono {
1082    font-family: var(--font-mono);
1083  }
1084  
1085  .launch-args {
1086    font-family: var(--font-mono);
1087    font-size: 10px;
1088    color: var(--color-text-quiet);
1089  }
1090  
1091  .launch-saved {
1092    font-size: 11.5px;
1093    color: var(--color-state-running-text);
1094  }
1095  
1096  .launch-link {
1097    align-self: flex-start;
1098    border: 0;
1099    background: transparent;
1100    padding: 0;
1101    font-size: 11.5px;
1102    color: var(--color-accent-jade);
1103    cursor: default;
1104  }
1105  
1106  .launch-link:hover {
1107    color: var(--color-accent-jade-hover);
1108  }
1109  
1110  .launch-save-row {
1111    display: flex;
1112    align-items: center;
1113    gap: 8px;
1114  }
1115  
1116  /* ── Footer ────────────────────────────────────────────────────────────── */
1117  .launch-foot {
1118    padding: 11px 18px;
1119  }
1120  
1121  .launch-foot-spacer {
1122    flex: 1;
1123  }
1124  </style>
1125  
```

### Exhibit 12 — `src/renderer/src/components/TerminalPane.vue` (lines 1–1142, 44261 bytes)

```vue
   1  <script setup lang="ts">
   2  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
   3  import { Terminal } from '@xterm/xterm'
   4  import { FitAddon } from '@xterm/addon-fit'
   5  import '@xterm/xterm/css/xterm.css'
   6  import type { AgentKind, WorktreeDiffSummary } from '../../../shared/ipc'
   7  import StateMarker from './StateMarker.vue'
   8  import ChorusMark from './ChorusMark.vue'
   9  import { useSessionStore, type PaneSessionState } from '../stores/session'
  10  import { useLayoutStore, type SplitTarget } from '../stores/layout'
  11  
  12  const props = defineProps<{ sessionId: string; agent: AgentKind }>()
  13  
  14  /** Ask App to open the launch dialog splitting THIS pane ('row' = side by
  15   *  side, 'column' = stacked — the axes splitPane() knows). `focus` fires when
  16   *  the terminal's input gains focus (1b-2), so the view store tracks the pane
  17   *  the user is actually typing in. */
  18  const emit = defineEmits<{ split: [target: SplitTarget]; focus: [sessionId: string] }>()
  19  
  20  const labels: Record<AgentKind, string> = {
  21    claude: 'Claude Code',
  22    codex: 'Codex',
  23    kimi: 'Kimi Code', // D86
  24    opencode: 'opencode' // D90
  25  }
  26  
  27  /** The design's two-letter agent tile, same codes the filmstrip card uses. */
  28  const codes: Record<AgentKind, string> = {
  29    claude: 'cc',
  30    codex: 'cx',
  31    kimi: 'km', // D86
  32    opencode: 'oc' // D90
  33  }
  34  
  35  const container = ref<HTMLDivElement | null>(null)
  36  const store = useSessionStore()
  37  const layoutStore = useLayoutStore()
  38  // Session state is keyed by the stable sessions-row id (D10); before the first
  39  // attach lands there is no entry yet, so read through a detached fallback.
  40  const pane = computed<PaneSessionState>(
  41    () =>
  42      store.sessions[props.sessionId] ?? {
  43        agent: props.agent,
  44        status: 'detached',
  45        exitCode: null,
  46        busy: false
  47      }
  48  )
  49  const dotStatus = computed(() => store.dotStatus(props.sessionId))
  50  
  51  /**
  52   * The header's state marker (3c-1's shared primitive, 3c-3 its first caller).
  53   * `dotStatus`'s four values collapse onto the THREE states the app can derive
  54   * (D78 — `needs-you` has no source and renders nowhere in this phase);
  55   * `detached` is the brief window before the first attach lands and shows no
  56   * marker at all, rather than claiming a shape the pane cannot stand behind.
  57   *
  58   * ⚠ SHAPE IS THE ENCODING, colour only reinforces it. A header that told these
  59   * states apart by colour alone would break the property StateMarker exists for.
  60   */
  61  const markerState = computed<'running' | 'error' | 'done' | null>(() => {
  62    switch (dotStatus.value) {
  63      case 'running':
  64        return 'running'
  65      case 'exited-error':
  66        return 'error'
  67      case 'exited-ok':
  68        return 'done'
  69      default:
  70        return null
  71    }
  72  })
  73  
  74  /** D16 chrome: the transient fresh-conversation badge (auto-restore and
  75   *  manual restart both mean "this is a new conversation"), and the overlay
  76   *  message for the pane's own states — restoring spinner, "Working directory
  77   *  not found" (cwd-missing is never a sentinel exit code), restart refusal. */
  78  const badge = ref(false)
  79  const paneMessage = ref<string | null>(null)
  80  let badgeTimer: ReturnType<typeof setTimeout> | undefined
  81  
  82  /** Session title (1b-1/D18): OSC 0/2 via onTitleChange wins and may keep
  83   *  updating live; the first Enter-terminated typed line is the fallback while
  84   *  no title has ever arrived. All writes go through session:set-title,
  85   *  debounced 500 ms TRAILING so a redraw-storm of OSC updates collapses to
  86   *  ~1 write per settle and the final title always lands. */
  87  const title = ref<string | null>(null)
  88  let pendingLine = ''
  89  let titleTimer: ReturnType<typeof setTimeout> | undefined
  90  
  91  /** Worktree branch label (2-2): seeded from the attach/launch response and
  92   *  STATIC per session — a worktree's branch never changes under Chorus, so
  93   *  there is no live update path (the seed survives F5 remounts exactly the
  94   *  way the title does). Null for current-tree sessions. */
  95  const branch = ref<string | null>(null)
  96  
  97  /** Owning worktree row id (2-3): seeded from the attach response with the
  98   *  same seed-once discipline as branch. The close flow's clean-removal
  99   *  offer / dirty detach acts by this id. Null for current-tree sessions. */
 100  const worktreeId = ref<string | null>(null)
 101  
 102  /** 2-4 diff summary (F12 cadence discipline): one interval ≥15 s per MOUNTED
 103   *  worktree pane, plus an on-focus refresh, cleared on unmount. A non-worktree
 104   *  pane (branch null) never creates the interval and never fetches. Filmstrip
 105   *  cards are not TerminalPanes, so they never poll. */
 106  const diff = ref<WorktreeDiffSummary | null>(null)
 107  let diffTimer: ReturnType<typeof setInterval> | undefined
 108  const DIFF_POLL_MS = 15_000
 109  
 110  /** True when any count is non-zero — the header stays clean on a pristine
 111   *  worktree instead of shouting 0f +0 −0. */
 112  const diffHasChanges = computed(
 113    () =>
 114      diff.value !== null &&
 115      (diff.value.filesChanged > 0 ||
 116        diff.value.insertions > 0 ||
 117        diff.value.deletions > 0 ||
 118        diff.value.untracked > 0)
 119  )
 120  
 121  async function refreshDiff(): Promise<void> {
 122    if (!branch.value) return // non-worktree session — never polls
 123    try {
 124      diff.value = await window.chorus.getWorktreeDiffSummary(props.sessionId)
 125    } catch (err) {
 126      // A transient git/read failure must not break the header — keep the last
 127      // good counts (or none) and let the next tick retry.
 128      console.warn('[pane] diff summary refresh failed:', err)
 129    }
 130  }
 131  
 132  /** 2-3 (D26 clause 5): the INLINE clean-worktree removal offer — never a
 133   *  window.confirm (it blocks the renderer thread). onClose parks on this
 134   *  promise until the user clicks Remove or Keep. */
 135  const closeOffer = ref(false)
 136  let closeOfferResolve: ((remove: boolean) => void) | null = null
 137  
 138  function offerCleanRemoval(): Promise<boolean> {
 139    closeOffer.value = true
 140    return new Promise((resolve) => {
 141      closeOfferResolve = resolve
 142    })
 143  }
 144  
 145  function resolveCloseOffer(remove: boolean): void {
 146    closeOffer.value = false
 147    closeOfferResolve?.(remove)
 148    closeOfferResolve = null
 149  }
 150  
 151  /** 2-3: close-flow notices must outlive this pane (it unmounts as the close
 152   *  completes), so they ride a window CustomEvent up to App's notice surface
 153   *  — emitting through the layout renderers would widen files outside 2-3's
 154   *  scope. Same window-listener pattern as App's Ctrl+K hotkey. */
 155  function notify(text: string): void {
 156    window.dispatchEvent(new CustomEvent('chorus:worktree-notice', { detail: { text } }))
 157  }
 158  
 159  function persistTitle(t: string): void {
 160    // An OSC title change can deliver '' (e.g. a TUI clearing its title);
 161    // main's schema requires min(1), so the write would reject as an unhandled
 162    // rejection. Whitespace-only would be silently no-oped in main anyway.
 163    if (t.trim().length === 0) return
 164    clearTimeout(titleTimer)
 165    titleTimer = setTimeout(() => {
 166      void window.chorus.setSessionTitle(props.sessionId, t)
 167    }, 500)
 168  }
 169  
 170  function showBadge(): void {
 171    badge.value = true
 172    clearTimeout(badgeTimer)
 173    badgeTimer = setTimeout(() => {
 174      badge.value = false
 175    }, 5000)
 176  }
 177  
 178  /* ------------------------------------------------------------------ */
 179  /* The xterm theme — the one surface in 3c-3 that is not CSS (spec §6)  */
 180  /* ------------------------------------------------------------------ */
 181  
 182  /** Read a 3c-1 token's value at runtime, so the theme object has no second
 183   *  home for any colour. `@theme static` guarantees every token is emitted as a
 184   *  :root custom property whether or not a utility references it. */
 185  function token(name: string): string {
 186    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
 187  }
 188  
 189  /** `#RRGGBB` -> `rgb(r g b / a)`. xterm takes colour STRINGS, so a translucent
 190   *  selection cannot be a CSS `color-mix()`; this derives it from the jade token
 191   *  rather than restating the literal the mock's `::selection` rule uses. */
 192  function withAlpha(hex: string, alpha: number): string {
 193    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
 194    if (!m) return hex
 195    const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
 196    return `rgb(${r} ${g} ${b} / ${alpha})`
 197  }
 198  
 199  /**
 200   * ⚠ FOUR KEYS, AND DELIBERATELY NO ANSI PALETTE. The 16 ANSI colours are the
 201   * AGENT'S output colours: overriding them changes what `claude` and `codex`
 202   * look like when they emit colour, which is a behavioural change wearing a
 203   * styling costume, and no mock specifies one. If they read wrong against the
 204   * new background that is a design question for Matthew, not an implementer's
 205   * call (spec §6 — escalate rather than decide).
 206   *
 207   * ⚠ `background` IS FULLY TRANSPARENT, AND IT IS NOT A MISSING VALUE. It used
 208   * to be `--color-surface-rail`. The pane's tone is now painted by CSS on
 209   * `.pane-terminal-region` instead, one layer down, so that the watermark can
 210   * sit BETWEEN the tone and the text (Matthew, 2026-07-27). The rendered colour
 211   * behind a cell is unchanged — the same token, drawn by a different element.
 212   *
 213   * ⚠ IT ONLY WORKS PAIRED WITH `allowTransparency: true` at construction. Left
 214   * off, xterm composites every cell against opaque black and the terminal turns
 215   * into a black rectangle — a dramatic failure, but one that looks like a theme
 216   * bug rather than a missing constructor flag. The two belong together.
 217   *
 218   * ⚠ AND THE VALUE MUST BE 8-DIGIT HEX, NOT A CSS `rgb(… / 0)`. Measured against
 219   * xterm 6.0.0 on 2026-07-27: `'rgb(0 0 0 / 0)'` came back out of its colour
 220   * parser as OPAQUE BLACK and was written onto `.xterm-scrollable-element`,
 221   * blacking out the pane. `#RRGGBBAA` is the form its parser round-trips with
 222   * the alpha intact. There is no warning and no type error — the only signal is
 223   * the rendered colour, which is why the measurement is recorded here.
 224   *
 225   * Cells the AGENT colours (an ANSI background) still paint over this, which is
 226   * correct: the watermark is behind Chorus's own surface, not behind the agent's
 227   * output.
 228   */
 229  function paneTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
 230    const jade = token('--color-accent-jade')
 231    return {
 232      background: '#00000000',
 233      foreground: token('--color-text-body'),
 234      cursor: jade,
 235      selectionBackground: withAlpha(jade, 0.25)
 236    }
 237  }
 238  
 239  let terminal: Terminal | null = null
 240  let fitAddon: FitAddon | null = null
 241  let resizeObserver: ResizeObserver | null = null
 242  let resizeTimer: ReturnType<typeof setTimeout> | undefined
 243  const cleanups: Array<() => void> = []
 244  
 245  function fitAndSyncPty(): void {
 246    if (!terminal || !fitAddon) return
 247    fitAddon.fit()
 248    if (pane.value.status === 'running') {
 249      void window.chorus.resizeSession(props.sessionId, terminal.cols, terminal.rows)
 250    }
 251  }
 252  
 253  /** Council resize strategy (D9/CR-1.2): `fit()` on every observer tick so the
 254   *  canvas tracks the pane visually, but the PTY resize is debounced to 150 ms
 255   *  of inactivity / drag-end — alt-screen TUIs corrupt under SIGWINCH storms. */
 256  function onContainerResize(): void {
 257    if (!terminal || !fitAddon) return
 258    fitAddon.fit()
 259    clearTimeout(resizeTimer)
 260    resizeTimer = setTimeout(() => {
 261      if (terminal && pane.value.status === 'running') {
 262        void window.chorus.resizeSession(props.sessionId, terminal.cols, terminal.rows)
 263      }
 264    }, 150)
 265  }
 266  
 267  /** Attach to this pane's main-process session by its stable sessions-row id,
 268   *  replaying buffered output. Attach is a PURE VIEW BINDING — it has no spawn
 269   *  path at all (Task 1-5/D16 removed the 1-4 attach-time relaunch gate;
 270   *  relaunch lives in session:restart and the restore engine only). The
 271   *  response's restore flags
 272   *  drive this pane's chrome: spinner while the engine's stagger reaches this
 273   *  id, the badge when it just came up, the cwd-missing message. */
 274  async function attachToSession(): Promise<void> {
 275    const attach = await window.chorus.attachSession({
 276      sessionId: props.sessionId,
 277      agent: props.agent
 278    })
 279    store.attached(attach.sessionId, props.agent, attach.status, attach.exitCode)
 280    // Seed the header from the persisted row ONLY while no live title exists —
 281    // a mid-session remount (F5) must not clobber a live OSC title with a stale
 282    // row value still waiting out the debounce.
 283    if (title.value === null && attach.title !== null) title.value = attach.title
 284    // 2-2: same seed-once discipline for the (static) worktree branch label.
 285    if (branch.value === null && attach.branch !== null) branch.value = attach.branch
 286    // 2-3: and for the owning worktree row id the close flow acts on.
 287    if (worktreeId.value === null && attach.worktreeId !== null) worktreeId.value = attach.worktreeId
 288    if (attach.restorePending) {
 289      paneMessage.value = 'Restoring session…'
 290    } else if (attach.cwdMissing) {
 291      paneMessage.value = 'Working directory not found'
 292    } else {
 293      paneMessage.value = null
 294    }
 295    if (attach.buffer.length > 0) {
 296      terminal?.write(attach.buffer)
 297    }
 298    if (attach.restored) showBadge()
 299  }
 300  
 301  /** Resolve when the given session's exit event arrives (used by the Restart
 302   *  and Close race guards). */
 303  function waitForExit(sessionId: string): Promise<void> {
 304    return new Promise((resolve) => {
 305      const off = window.chorus.onSessionExit((event) => {
 306        if (event.sessionId === sessionId) {
 307          off()
 308          resolve()
 309        }
 310      })
 311    })
 312  }
 313  
 314  async function onKill(): Promise<void> {
 315    if (pane.value.status !== 'running') return
 316    store.setBusy(props.sessionId, true)
 317    try {
 318      await window.chorus.killSession(props.sessionId)
 319      // no local state change — the onSessionExit listener flips the status
 320    } finally {
 321      store.setBusy(props.sessionId, false)
 322    }
 323  }
 324  
 325  async function onClose(): Promise<void> {
 326    if (pane.value.busy) return
 327    if (closeOffer.value) return // a clean-removal offer is already pending
 328    if (pane.value.status === 'running') {
 329      if (!window.confirm('Kill this session and close the pane?')) return
 330      store.setBusy(props.sessionId, true)
 331      try {
 332        // Race guard: register before killing, and close only after the old
 333        // session's exit event lands — no row is deleted while its PTY lives.
 334        const exited = waitForExit(props.sessionId)
 335        await window.chorus.killSession(props.sessionId)
 336        await exited
 337      } finally {
 338        store.setBusy(props.sessionId, false)
 339      }
 340    }
 341    // 2-3 (D26 clause 5): the worktree decision lands AFTER the awaited exit
 342    // (the process tree is dead before anything is removed — clause 8) and
 343    // BEFORE the leaf/row cleanup. Cleanliness is read FRESH here via
 344    // worktree:dirty-files — an attach-time snapshot would be stale by close;
 345    // main's worktree:remove re-checks once more at execution (defense in
 346    // depth: this read narrows the race window, the handler's closes it).
 347    if (worktreeId.value) {
 348      const wtId = worktreeId.value
 349      let clean = false
 350      try {
 351        clean = (await window.chorus.getWorktreeDirtyFiles(wtId)).length === 0
 352      } catch {
 353        clean = false // unreadable → protective dirty: no offer, silent detach
 354      }
 355      if (clean) {
 356        // Inline offer (no window.confirm); declining takes the same path as
 357        // dirty — session:delete below detaches, retaining the worktree.
 358        const remove = await offerCleanRemoval()
 359        if (!terminal) return // unmounted mid-offer (F13): abandon the close
 360        if (remove) {
 361          try {
 362            const res = await window.chorus.removeWorktree({ worktreeId: wtId })
 363            if (!res.ok) {
 364              // Main's live re-check disagreed (dirtied in the race) or git
 365              // refused — the worktree is retained and detached instead.
 366              notify(res.reason)
 367            }
 368          } catch (err) {
 369            console.error('[pane] worktree:remove failed:', err)
 370            notify('Worktree removal failed — it is retained; see Manage worktrees')
 371          }
 372        }
 373      } else {
 374        // Dirty: silent detach is the contract default (clause 5) — the
 375        // session:delete below detaches transactionally; the notice tells the
 376        // user where their uncommitted work went.
 377        notify('Worktree kept (uncommitted work) — see Manage worktrees')
 378      }
 379    }
 380    // Close ordering (D16 clause 5): kill -> awaited exit -> leaf removed ->
 381    // row deleted. Sibling absorbs the freed slot; closing the LAST leaf nulls
 382    // the tree and clears the persisted layout, returning to the empty state.
 383    layoutStore.removeLeaf(props.sessionId)
 384    try {
 385      await window.chorus.deleteSession(props.sessionId)
 386    } catch (err) {
 387      // The pane is already gone; the surviving row is exited drift that the
 388      // next boot's reconcile pass cleans up. Log and move on.
 389      console.error('[pane] session:delete failed:', err)
 390    }
 391    // 3c-3: the two surfaces that COUNT sessions — the rail's per-project count
 392    // and the status bar's tally — have no other way to learn a close happened.
 393    // Same window-CustomEvent route the worktree notice above takes, and for the
 394    // same reason: this component cannot emit up to App without widening
 395    // LayoutRenderer and FilmstripRenderer, and it is unmounting anyway.
 396    //
 397    // ⚠ FIRED EVEN IF session:delete THREW. App answers this by RE-READING main,
 398    // never by decrementing a local number, so a row that survived a failed
 399    // delete is still counted — which is the truth, and is what the next boot's
 400    // reconcile pass will act on.
 401    window.dispatchEvent(
 402      new CustomEvent('chorus:session-closed', { detail: { sessionId: props.sessionId } })
 403    )
 404  }
 405  
 406  async function onRestart(): Promise<void> {
 407    store.setBusy(props.sessionId, true)
 408    try {
 409      if (pane.value.status === 'running') {
 410        // Race guard: register before killing, and restart only after the old
 411        // session's exit event lands — main refuses to restart a live session.
 412        const exited = waitForExit(props.sessionId)
 413        await window.chorus.killSession(props.sessionId)
 414        await exited
 415      }
 416      // D16 clause 4: ONE restart path — in-run and post-restart alike. Main
 417      // reads the row, re-validates cwd, spawns under the SAME row id (no row
 418      // creation), and writes 'running' only after the spawn succeeds.
 419      const res = await window.chorus.restartSession(props.sessionId)
 420      if ('ok' in res) {
 421        paneMessage.value = res.reason
 422        return
 423      }
 424      paneMessage.value = null
 425      terminal?.reset()
 426      store.attached(res.sessionId, props.agent, res.status, res.exitCode)
 427      if (res.buffer.length > 0) {
 428        terminal?.write(res.buffer)
 429      }
 430      showBadge()
 431    } finally {
 432      store.setBusy(props.sessionId, false)
 433    }
 434  }
 435  
 436  /**
 437   * Task 3a-5 / D53: relaunch a session that was healed to `exited` because it
 438   * held a credential.
 439   *
 440   * ⚠ THIS CLICK IS THE WHOLE SECURITY ARGUMENT. Restore stays decision (b): the
 441   * boot path heals such a session and decrypts NOTHING. Main re-resolves the
 442   * credential here only because a human asked, at the keyboard, right now.
 443   *
 444   * Mirrors onRestart's shape but does NOT kill first — a relaunch target is
 445   * already exited by construction (the button only renders for a non-running
 446   * pane), and killing a dead session would be a no-op with a race attached.
 447   *
 448   * ⚠ BOTH BUTTONS STAY. Restart's refusal on a credentialed session is not a
 449   * wart to hide; it is what makes the two verbs legible — restart means "same
 450   * configuration, NO credential", relaunch means "same configuration, credential
 451   * re-resolved because you asked".
 452   */
 453  async function onRelaunch(): Promise<void> {
 454    if (pane.value.status === 'running') return
 455    store.setBusy(props.sessionId, true)
 456    try {
 457      const res = await window.chorus.relaunchSession(props.sessionId)
 458      if ('ok' in res) {
 459        // Every refusal is authored in main and label-only: a legacy or
 460        // bare-credential session says "use the launch dialog", an unavailable
 461        // credential names itself, and neither leaks a URL or a key fragment.
 462        paneMessage.value = res.reason
 463        return
 464      }
 465      paneMessage.value = null
 466      terminal?.reset()
 467      store.attached(res.sessionId, props.agent, res.status, res.exitCode)
 468      if (res.buffer.length > 0) {
 469        terminal?.write(res.buffer)
 470      }
 471      showBadge()
 472    } finally {
 473      store.setBusy(props.sessionId, false)
 474    }
 475  }
 476  
 477  onMounted(async () => {
 478    terminal = new Terminal({
 479      cursorBlink: true,
 480      // 5000 caps scrollback-reflow cost on column change (50-200 ms at 10k+).
 481      scrollback: 5_000,
 482      fontSize: 14,
 483      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
 484      // The other half of the transparent theme background above — see the
 485      // warning on paneTheme(). This app uses xterm's DOM renderer (no
 486      // addon-webgl / addon-canvas is loaded anywhere), which is where the
 487      // upstream "may impact performance" caveat for this flag bites least: the
 488      // DOM renderer already emits per-cell elements, so a transparent default
 489      // background removes paint work rather than adding it.
 490      allowTransparency: true,
 491      theme: paneTheme()
 492    })
 493    fitAddon = new FitAddon()
 494    terminal.loadAddon(fitAddon)
 495    terminal.open(container.value!)
 496  
 497    // 1b-2: xterm's input textarea exists once open() has run (D4-verified:
 498    // `readonly textarea: HTMLTextAreaElement | undefined` in @xterm/xterm 6).
 499    // 2-4: the same focus event also refreshes the diff summary (on-focus
 500    // refresh, F12 — the interval is the other half of the cadence).
 501    const onTextareaFocus = (): void => {
 502      emit('focus', props.sessionId)
 503      void refreshDiff()
 504    }
 505    terminal.textarea?.addEventListener('focus', onTextareaFocus)
 506    cleanups.push(() => terminal?.textarea?.removeEventListener('focus', onTextareaFocus))
 507  
 508    await attachToSession()
 509  
 510    // A focus swap (F5 keyed remount) or pane close can unmount this component
 511    // while the attach is in flight; onBeforeUnmount has then already run the
 512    // cleanups and nulled `terminal`. Registering anything past this point would
 513    // leak listeners for the app lifetime (the leaked onSessionRestored handler
 514    // could even re-attach a dead pane and consume the F10 badge meant for the
 515    // live one) — bail out instead.
 516    if (!terminal) return
 517  
 518    cleanups.push(
 519      window.chorus.onSessionData((event) => {
 520        if (event.sessionId === props.sessionId) {
 521          terminal?.write(event.data)
 522        }
 523      }),
 524      window.chorus.onSessionExit((event) => {
 525        if (event.sessionId === props.sessionId) {
 526          store.exited(props.sessionId, event.exitCode)
 527        }
 528      }),
 529      window.chorus.onSessionRestored((event) => {
 530        if (event.sessionId !== props.sessionId) return
 531        // The restore engine concluded for this id (relaunched, healed, or
 532        // cwd-missing): re-attach to land on whatever main now reports. The
 533        // badge shows only when the attach comes back live (attach.restored).
 534        terminal?.reset()
 535        void attachToSession()
 536      })
 537    )
 538  
 539    // OSC 0/2 title capture (D18): xterm parses the escape sequence and fires
 540    // onTitleChange with the new title. OSC wins and may keep updating live.
 541    const titleDisposable = terminal.onTitleChange((t) => {
 542      title.value = t
 543      persistTitle(t)
 544    })
 545    cleanups.push(() => titleDisposable.dispose())
 546  
 547    const dataDisposable = terminal.onData((data) => {
 548      if (pane.value.status === 'running') {
 549        void window.chorus.writeSession(props.sessionId, data)
 550      }
 551      // First-line fallback (D18): buffer keystrokes until Enter; adopt the line
 552      // only while no title (OSC or earlier fallback) has ever arrived.
 553      if (title.value !== null) return
 554      if (data === '\r') {
 555        const line = pendingLine.trim().slice(0, 120)
 556        pendingLine = ''
 557        if (line.length > 0) {
 558          title.value = line
 559          persistTitle(line)
 560        }
 561      } else if (data === '\x7f') {
 562        pendingLine = pendingLine.slice(0, -1)
 563      } else if (data >= ' ') {
 564        pendingLine += data
 565      }
 566    })
 567    cleanups.push(() => dataDisposable.dispose())
 568  
 569    resizeObserver = new ResizeObserver(() => onContainerResize())
 570    resizeObserver.observe(container.value!)
 571  
 572    // 2-4: start the diff poll only for a worktree pane (branch non-null after
 573    // attach). One interval ≥15 s + the on-focus refresh above; cleared in
 574    // onBeforeUnmount. A current-tree pane never reaches this branch.
 575    if (branch.value) {
 576      void refreshDiff()
 577      diffTimer = setInterval(() => void refreshDiff(), DIFF_POLL_MS)
 578    }
 579  
 580    fitAndSyncPty()
 581  })
 582  
 583  onBeforeUnmount(() => {
 584    clearTimeout(resizeTimer)
 585    clearTimeout(badgeTimer)
 586    clearTimeout(titleTimer)
 587    clearInterval(diffTimer)
 588    // Resolve a parked clean-removal offer so onClose's continuation can bail
 589    // (it checks `terminal` right after) instead of leaking the promise (F13).
 590    closeOfferResolve?.(false)
 591    resizeObserver?.disconnect()
 592    for (const cleanup of cleanups) cleanup()
 593    terminal?.dispose()
 594    terminal = null
 595    fitAddon = null
 596  })
 597  </script>
 598  
 599  <template>
 600    <!-- `pane-shell` exists for ONE reason: the focus ring below. It carries no
 601         layout — the Tailwind utilities still do all of that — so removing the
 602         ring removes the class with nothing else attached to it. -->
 603    <div class="pane-shell flex h-full flex-col">
 604      <!-- The pane header, to the design's anatomy (3c-3 / spec §5): a state row
 605           over a metadata row. Everything on it comes from data the pane ALREADY
 606           has — the mock's elapsed clock, `$0.84` cost, model name, effort meter
 607           and permission-mode chip are all facts Chorus does not carry, and D76
 608           omits them rather than inventing them. No data source was added here. -->
 609      <div class="pane-header">
 610        <div class="pane-header-row">
 611          <StateMarker v-if="markerState" :state="markerState" />
 612          <span class="pane-title" :title="title ?? labels[props.agent]">
 613            {{ title ?? labels[props.agent] }}
 614          </span>
 615          <span class="pane-rule" />
 616          <div class="pane-controls">
 617            <button
 618              type="button"
 619              class="pane-btn"
 620              title="Launch a session in a split beside this pane"
 621              @click="emit('split', { targetSessionId: props.sessionId, direction: 'row' })"
 622            >
 623              ⬌
 624            </button>
 625            <button
 626              type="button"
 627              class="pane-btn"
 628              title="Launch a session in a split below this pane"
 629              @click="emit('split', { targetSessionId: props.sessionId, direction: 'column' })"
 630            >
 631              ⬍
 632            </button>
 633            <!-- The restart glyph is the mock's own, verbatim. The other controls
 634                 keep their labels: the design draws five icon buttons for five
 635                 verbs Chorus does not have (pop out, duplicate, copy transcript),
 636                 and an icon invented for Kill would sit beside Close's ✕ as a
 637                 second X — losing a distinction the header has today. -->
 638            <button
 639              type="button"
 640              class="pane-btn pane-btn-icon"
 641              :disabled="pane.busy"
 642              title="Restart this session"
 643              @click="onRestart"
 644            >
 645              <svg
 646                width="13"
 647                height="13"
 648                viewBox="0 0 14 14"
 649                fill="none"
 650                stroke="currentColor"
 651                stroke-width="1.2"
 652                aria-hidden="true"
 653              >
 654                <path d="M12 7a5 5 0 1 1-1.7-3.75" />
 655                <path d="M12 1.5v3h-3" fill="none" />
 656              </svg>
 657            </button>
 658            <!-- 3a-5 (D53): only on a non-running pane. Main authors every refusal
 659                 (no profile, unavailable credential, cwd gone), so this button is
 660                 never conditionally hidden on a guess the renderer made. -->
 661            <button
 662              v-if="pane.status !== 'running'"
 663              type="button"
 664              class="pane-btn pane-btn-accent"
 665              :disabled="pane.busy"
 666              title="Re-resolve this session's stored credential and start it again"
 667              data-relaunch
 668              @click="onRelaunch"
 669            >
 670              Relaunch
 671            </button>
 672            <button
 673              type="button"
 674              class="pane-btn pane-btn-danger"
 675              :disabled="pane.busy || pane.status !== 'running'"
 676              title="Kill this session, keeping the pane"
 677              @click="onKill"
 678            >
 679              Kill
 680            </button>
 681            <button
 682              type="button"
 683              class="pane-btn pane-btn-danger"
 684              :disabled="pane.busy"
 685              title="Kill session and close pane"
 686              @click="onClose"
 687            >
 688              ✕
 689            </button>
 690          </div>
 691        </div>
 692  
 693        <div class="pane-meta">
 694          <span class="pane-tile">{{ codes[props.agent] }}</span>
 695          <span class="pane-agent">{{ labels[props.agent] }}</span>
 696          <template v-if="branch">
 697            <span class="pane-rule-sm" />
 698            <span class="pane-branch" :title="branch">
 699              <!-- The mock's worktree glyph. -->
 700              <svg
 701                width="10"
 702                height="11"
 703                viewBox="0 0 10 11"
 704                fill="none"
 705                stroke="currentColor"
 706                stroke-width="1"
 707                aria-hidden="true"
 708              >
 709                <circle cx="2.5" cy="2.5" r="1.5" />
 710                <circle cx="2.5" cy="8.5" r="1.5" />
 711                <circle cx="7.5" cy="5.5" r="1.5" />
 712                <path d="M2.5 4v3M4 5.5h2" />
 713              </svg>
 714              <span class="pane-branch-name">{{ branch }}</span>
 715            </span>
 716          </template>
 717          <!-- 2-4: read-only diff summary vs HEAD in this worktree; hidden while
 718               pristine (all-zero) so a clean header stays quiet. -->
 719          <template v-if="diff && diffHasChanges">
 720            <span class="pane-rule-sm" />
 721            <span class="pane-diff" title="vs HEAD in this worktree">
 722              {{ diff.filesChanged }}f
 723              <span class="pane-diff-add">+{{ diff.insertions }}</span>
 724              <span class="pane-diff-del">−{{ diff.deletions }}</span>
 725              <span v-if="diff.untracked">· {{ diff.untracked }}?</span>
 726            </span>
 727          </template>
 728          <span v-if="badge" class="pane-chip">Session restarted — new conversation</span>
 729        </div>
 730      </div>
 731      <div class="pane-terminal-region relative min-h-0 flex-1">
 732        <!-- The watermark. FIRST in the region and therefore under everything
 733             that follows it — the terminal, the pane overlay, the close offer.
 734             It is inert decoration: no state, no props, no listeners. -->
 735        <div class="pane-watermark" aria-hidden="true">
 736          <ChorusMark :height="76" />
 737        </div>
 738        <!-- 3a-2: the attention attribute sits on the TERMINAL HOST, not the
 739             pane card. That placement IS the ruling: a click on this pane's
 740             header buttons, the splitter, or a filmstrip card resolves to null
 741             and lands in the per-project overhead bucket (table row 7), where
 742             §5.3 puts "reviewing the board, reading diffs". On the card, every
 743             header click would become task attention and the overhead bucket
 744             would be nearly empty — a bug that presents as "the numbers are
 745             suspiciously clean". -->
 746        <div
 747          ref="container"
 748          :data-attention-session="props.sessionId"
 749          class="terminal-container h-full p-1"
 750        ></div>
 751        <div v-if="paneMessage" class="pane-overlay">
 752          {{ paneMessage }}
 753        </div>
 754        <!-- 2-3 (D26 clause 5): inline clean-worktree removal offer — never a
 755             window.confirm (it blocks the renderer thread). -->
 756        <div
 757          v-if="closeOffer"
 758          class="pane-offer absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-2 text-xs"
 759        >
 760          <span class="pane-offer-text min-w-0 truncate">
 761            Worktree
 762            <span v-if="branch" class="pane-offer-branch">{{ branch }}</span>
 763            is clean — nothing uncommitted. Remove it?
 764          </span>
 765          <span class="flex shrink-0 gap-2">
 766            <button
 767              class="pane-offer-danger px-2 py-0.5"
 768              title="Remove the worktree directory and its record (the branch is kept)"
 769              @click="resolveCloseOffer(true)"
 770            >
 771              Remove worktree
 772            </button>
 773            <button
 774              class="pane-offer-ghost px-2 py-0.5"
 775              title="Keep the worktree — find it later under Manage worktrees"
 776              @click="resolveCloseOffer(false)"
 777            >
 778              Keep
 779            </button>
 780          </span>
 781        </div>
 782      </div>
 783    </div>
 784  </template>
 785  
 786  <style scoped>
 787  /* ── The active pane: a tinted TITLE BAR, not a border ───────────────────
 788   *
 789   * "Where is my cursor?" — with several panes on screen, the answer was nowhere
 790   * on the screen.
 791   *
 792   * ⚠ THIS REPLACED A 1px FOCUS RING, AND THE REASON IS WORTH KEEPING: the ring
 793   * COMPETED WITH THE BORDERS ALREADY THERE. A pane sits inside splitpanes
 794   * gutters and carries its own `--color-border-panel` header rule, so a third
 795   * line an alpha away from the other two read as a rendering artefact rather
 796   * than as state. A FILLED REGION does not compete with a line — it is a
 797   * different visual channel, so it reads at a glance without adding a fourth
 798   * edge to a screen already full of them.
 799   *
 800   * ⚠ `:focus-within`, NOT A `focused` PROP, AND THAT PART SURVIVED THE REDESIGN.
 801   * The app has a `viewStore.focusedSessionId` and it would have been the obvious
 802   * thing to bind — but it is WRONG here: `LayoutRenderer` binds no `@focus`
 803   * (App.vue says so in as many words), so in split mode — the only mode where
 804   * this question can even be asked — that value never updates, and two panes
 805   * would share one stale highlight. `:focus-within` reads the live DOM, is true
 806   * in both view modes, needs no store, prop, event or parent wiring, and cannot
 807   * drift because there is nothing to keep in sync. Same reasoning as App's own
 808   * `onFocusIn` walk.
 809   *
 810   * ⚠ A BACKGROUND FILL MOVES NOTHING. Like the inset shadow it replaced, and
 811   * unlike a border, it occupies no box — so focus cannot shift the terminal by a
 812   * pixel and re-fire the ResizeObserver that the rule below exists to keep quiet.
 813   *
 814   * ⚠ THE COLOUR IS MIXED FROM `--color-accent-jade`, NOT COPIED FROM THE
 815   * WATERMARK'S TOKEN, AND THAT IS DELIBERATE. The brief was "the same faded-out
 816   * green as the watermark logo", and the watermark is `ChorusMark` at
 817   * `--opacity-terminal-watermark: 0.04`. Referencing that token would couple this
 818   * rule to it; mixing from the jade token both files already share gets the same
 819   * family with no dependency. The ALPHA is deliberately NOT 4%: the watermark is
 820   * a large shape where 4% reads, while this is a ~60px strip where it would not.
 821   * The value below was chosen by looking at it, not by arithmetic. */
 822  .pane-shell .pane-header {
 823    transition: background-color 120ms ease;
 824  }
 825  
 826  .pane-shell:focus-within .pane-header {
 827    background-color: color-mix(in srgb, var(--color-accent-jade) 10%, transparent);
 828  }
 829  
 830  /* The fade is decoration; the tint itself is information, so reduced motion
 831     drops the transition and KEEPS the tint (3c-1's standing rule). */
 832  @media (prefers-reduced-motion: reduce) {
 833    .pane-shell .pane-header {
 834      transition: none;
 835    }
 836  }
 837  
 838  /* Hide xterm's viewport scrollbar: its appearing/disappearing on fit() would
 839     resize the container and re-fire the ResizeObserver in a loop (CR-1.2). */
 840  .terminal-container :deep(.xterm-viewport) {
 841    overflow: hidden !important;
 842  
 843    /* ⚠ AND UNPAINT IT, WHICH IS NOT THE SAME AS THE THEME BEING TRANSPARENT.
 844       `@xterm/xterm/css/xterm.css` hard-codes `.xterm .xterm-viewport {
 845       background-color: #000 }` — a STATIC RULE, commented there as a macOS
 846       scrollbar-opacity workaround, that no theme value can reach. Verified
 847       against xterm 6.0.0 at runtime (2026-07-27): with the theme already
 848       transparent this element still computed to `rgb(0, 0, 0)` and turned the
 849       whole terminal black. The scrollbar it protects is hidden one line above,
 850       and Chorus is Windows-only in v1, so there is nothing here to preserve.
 851  
 852       Without this the watermark is invisible AND the pane's tone is wrong —
 853       and it reads as a theme bug, because the theme is the only place anyone
 854       looks. */
 855    background-color: transparent !important;
 856  }
 857  
 858  /* ── The pane header (3c-3), read from the mock's `<!-- pane header -->` block.
 859        Every value is a 3c-1 token — no raw hex, no stock palette utility. ── */
 860  
 861  .pane-header {
 862    flex: none;
 863    display: flex;
 864    flex-direction: column;
 865    gap: 7px;
 866    padding: 10px 12px 9px;
 867    border-bottom: 1px solid var(--color-border-panel);
 868    user-select: none;
 869  }
 870  
 871  .pane-header-row {
 872    display: flex;
 873    align-items: center;
 874    gap: 10px;
 875  }
 876  
 877  .pane-title {
 878    flex: 1;
 879    min-width: 0;
 880    font-size: 13.5px;
 881    font-weight: 600;
 882    color: var(--color-text-primary);
 883    white-space: nowrap;
 884    overflow: hidden;
 885    text-overflow: ellipsis;
 886  }
 887  
 888  .pane-rule {
 889    flex: none;
 890    width: 1px;
 891    height: 14px;
 892    background: var(--color-border-divider);
 893  }
 894  
 895  .pane-rule-sm {
 896    flex: none;
 897    width: 1px;
 898    height: 12px;
 899    background: var(--color-border-divider);
 900  }
 901  
 902  .pane-controls {
 903    display: flex;
 904    gap: 2px;
 905  }
 906  
 907  .pane-btn {
 908    height: 24px;
 909    min-width: 24px;
 910    display: flex;
 911    align-items: center;
 912    justify-content: center;
 913    padding: 0 6px;
 914    border: 0;
 915    border-radius: var(--radius-icon);
 916    background: transparent;
 917    color: var(--color-text-tertiary);
 918    font-family: var(--font-sans);
 919    font-size: 11px;
 920    cursor: default;
 921  }
 922  
 923  .pane-btn-icon {
 924    padding: 0;
 925  }
 926  
 927  .pane-btn:hover:not(:disabled) {
 928    background: var(--color-surface-icon-hover);
 929    color: var(--color-text-body);
 930  }
 931  
 932  .pane-btn:disabled {
 933    opacity: 0.4;
 934  }
 935  
 936  /* Kill and close are DESTRUCTIVE, and the mock gives that class of control its
 937     own hover rather than the neutral one. */
 938  .pane-btn-danger:hover:not(:disabled) {
 939    background: var(--color-surface-danger-hover);
 940    color: var(--color-state-error-hover);
 941  }
 942  
 943  .pane-btn-accent {
 944    color: var(--color-accent-jade);
 945  }
 946  
 947  .pane-btn-accent:hover:not(:disabled) {
 948    background: var(--color-surface-icon-hover);
 949    color: var(--color-accent-jade-hover);
 950  }
 951  
 952  .pane-meta {
 953    display: flex;
 954    align-items: center;
 955    gap: 8px;
 956    min-width: 0;
 957    font-family: var(--font-mono);
 958    font-size: 11px;
 959    color: var(--color-text-muted);
 960  }
 961  
 962  .pane-tile {
 963    width: 16px;
 964    height: 16px;
 965    flex: none;
 966    display: flex;
 967    align-items: center;
 968    justify-content: center;
 969    border-radius: var(--radius-chip);
 970    background: var(--color-surface-badge);
 971    border: 1px solid var(--color-border-badge);
 972    font-size: 8.5px;
 973    letter-spacing: 0.05em;
 974    color: var(--color-text-badge);
 975  }
 976  
 977  .pane-agent {
 978    flex: none;
 979    color: var(--color-text-body);
 980  }
 981  
 982  .pane-branch {
 983    display: flex;
 984    align-items: center;
 985    gap: 5px;
 986    min-width: 0;
 987    color: var(--color-text-quiet);
 988  }
 989  
 990  .pane-branch-name {
 991    white-space: nowrap;
 992    overflow: hidden;
 993    text-overflow: ellipsis;
 994  }
 995  
 996  .pane-diff {
 997    flex: none;
 998    font-size: 10px;
 999    color: var(--color-text-quiet);
1000  }
1001  
1002  .pane-diff-add {
1003    color: var(--color-state-running-text);
1004  }
1005  
1006  .pane-diff-del {
1007    color: var(--color-state-error-text);
1008  }
1009  
1010  /* The transient fresh-conversation badge (D16), in the mock's chip idiom. */
1011  .pane-chip {
1012    flex: none;
1013    border: 1px solid var(--color-border-badge);
1014    background: var(--color-surface-field);
1015    border-radius: var(--radius-chip);
1016    padding: 1px 6px;
1017    font-size: 10px;
1018    color: var(--color-text-secondary);
1019  }
1020  
1021  .pane-overlay {
1022    position: absolute;
1023    inset: 0;
1024    display: flex;
1025    align-items: center;
1026    justify-content: center;
1027    background: color-mix(in srgb, var(--color-surface-rail) 90%, transparent);
1028    font-size: 13px;
1029    color: var(--color-text-secondary);
1030    user-select: none;
1031  }
1032  
1033  /* ── The clean-worktree removal offer ───────────────────────────────────────
1034     ⚠ UNMOCKED SURFACE — TOKEN CONFORMANCE ONLY. No mock draws this strip (D26
1035     clause 5 invented it), so nothing here is read from one literally; each
1036     value is the 3c-1 token whose documented ROLE this element plays. Phase 3c
1037     left five stock palette utilities here because the strip is 3c-3's
1038     territory and 3c-5 declined to widen its diff silently; this is that debt.
1039  
1040     The strip is an ELEVATED PANEL over the terminal, not part of the terminal:
1041     `--color-surface-overlay` is the token for that (command palette, launch
1042     dialog, mission popover). The 95% is the one thing carried over verbatim
1043     from the utility it replaced — a colour swap, not an opacity retune. The
1044     rule matches the pane's own header rule rather than the Launch Dialog
1045     footer's `--color-border-segment`, so this card draws ONE rule colour. */
1046  .pane-offer {
1047    border-top: 1px solid var(--color-border-panel);
1048    background: color-mix(in srgb, var(--color-surface-overlay) 95%, transparent);
1049  }
1050  
1051  .pane-offer-text {
1052    color: var(--color-text-body);
1053  }
1054  
1055  /* Jade, matching `WorktreePanel.vue`'s `.wt-branch` and the Launch Dialog
1056     mock's worktree path (`#3BCFAE`). Deliberately colour-only: the mock also
1057     sets that identifier in mono, and changing the face here would be a
1058     restyle rather than the token swap this change is. */
1059  .pane-offer-branch {
1060    color: var(--color-accent-jade);
1061  }
1062  
1063  /* ⚠ THIS WAS A SOLID RED FILL, AND NO TOKEN SUPPORTS ONE. The mocks draw
1064     exactly two destructive treatments: the titlebar close hover (whose token
1065     says "titlebar close only") and the kill button's tint. The tinted confirm
1066     below is what `.overlay-btn-danger` already gives THE SAME ACTION — the
1067     worktree panel's "Remove worktree" — so this strip now agrees with the
1068     other place the app offers it, and no new token was invented. */
1069  .pane-offer-danger {
1070    border: 1px solid color-mix(in srgb, var(--color-state-error) 45%, transparent);
1071    border-radius: var(--radius-icon);
1072    background: color-mix(in srgb, var(--color-state-error) 14%, transparent);
1073    color: var(--color-state-error-text);
1074    cursor: default;
1075  }
1076  
1077  .pane-offer-danger:hover {
1078    background: color-mix(in srgb, var(--color-state-error) 22%, transparent);
1079    color: var(--color-state-error-hover);
1080  }
1081  
1082  /* The declining action, in the pane's own ghost-control idiom (`.pane-btn`). */
1083  .pane-offer-ghost {
1084    border: 0;
1085    border-radius: var(--radius-icon);
1086    background: transparent;
1087    color: var(--color-text-secondary);
1088    cursor: default;
1089  }
1090  
1091  .pane-offer-ghost:hover {
1092    background: var(--color-surface-icon-hover);
1093    color: var(--color-text-body);
1094  }
1095  
1096  /* ⚠ THE BACKGROUND MOVED UP ONE LEVEL, AND THAT IS WHAT MAKES THE WATERMARK
1097     POSSIBLE. It used to live here, on the terminal host. It now lives on
1098     `.pane-terminal-region` below, with this element and the xterm theme both
1099     fully transparent — so the paint order is: region tone, then watermark, then
1100     the terminal's glyphs. Put a background back on this element and the
1101     watermark vanishes behind it with no other symptom. */
1102  .terminal-container {
1103    background: transparent;
1104  }
1105  
1106  /* The terminal region: the tone the xterm theme used to paint itself, now
1107     painted once behind everything in the region. */
1108  .pane-terminal-region {
1109    background: var(--color-surface-rail);
1110  }
1111  
1112  /* ── The watermark (Matthew, 2026-07-27) ────────────────────────────────────
1113     The official mark, ghosted behind each session's output. THE BRIEF WAS
1114     "very, very subtle … just barely visible so as to not interfere with text",
1115     and every value here serves that:
1116  
1117     - `--opacity-terminal-watermark` (main.css) is the one dial. It is a token so
1118       it can be tuned in one place against a real screenshot rather than guessed
1119       at per pane.
1120     - `pointer-events: none` — it must never eat a click meant for the terminal,
1121       which sits above it and owns every interaction in this region.
1122     - It scales with the pane (`width: 34%`) instead of holding a fixed size, so
1123       a narrow split gets a proportionally smaller mark rather than a cropped
1124       one. The clamp keeps it from becoming either a speck or a billboard.
1125     - `aria-hidden` on the element: it is decoration, and a screen reader
1126       announcing the logo once per pane would be noise. */
1127  .pane-watermark {
1128    position: absolute;
1129    inset: 0;
1130    display: flex;
1131    align-items: center;
1132    justify-content: center;
1133    pointer-events: none;
1134    opacity: var(--opacity-terminal-watermark);
1135  }
1136  
1137  .pane-watermark :deep(svg) {
1138    width: clamp(72px, 34%, 300px);
1139    height: auto;
1140  }
1141  </style>
1142  
```


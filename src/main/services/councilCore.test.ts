import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assembleFindingsDocument,
  assembleRun,
  computeDisagreement,
  computeRunAccounting,
  dissentsElided,
  extractDissentEntries,
  nextAction,
  parseBriefQuestions,
  parseCritiqueSections,
  parseVerdicts,
  routeAcceptsMintedKey,
  statesNoObjection,
  synthesisCarriesDissentHeading,
  type AssemblyCandidate,
  type CouncilAction,
  type CouncilState,
  type CouncilTranscriptEntry,
  type PlannedMember,
  type PlannedRun
} from './councilCore'

/**
 * Task 3b-3: the protocol as a PURE STATE MACHINE — feed it states, assert the
 * next action. No network, no clock, no storage, no mocks.
 *
 * The table follows `councilMembers.test.ts`'s style. What it is really for:
 * every branch of a deliberation protocol is otherwise exercisable only by a
 * billable live run, and a rule nobody can afford to test is a rule nobody
 * checks.
 */

const GATEWAY = 'https://openrouter.ai/api/v1'

const BRIEF = [
  '# A brief',
  '',
  'Some framing prose that is not a question.',
  '',
  '1. Should the widget be blue?',
  '2. Should the widget be round?',
  '3. Is the widget necessary at all?'
].join('\n')

const member = (id: string, label: string, role: 'member' | 'arbiter' = 'member'): PlannedMember => ({
  memberId: id,
  label,
  credentialProfileId: `cred-${id}`,
  model: `vendor/model-${id}`,
  role,
  params: {}
})

const RUN: PlannedRun = {
  members: [member('m1', 'Alpha'), member('m2', 'Beta'), member('m3', 'Gamma')],
  arbiter: member('arb', 'Arbiter', 'arbiter'),
  briefText: BRIEF
}

const entry = (
  memberId: string | null,
  phase: CouncilTranscriptEntry['phase'],
  round: number,
  content: string,
  outcome: CouncilTranscriptEntry['outcome'] = 'answered'
): CouncilTranscriptEntry => ({ memberId, round, phase, content, outcome })

/** Provenance the core renders and cannot derive (D68(2)) — fixed here so the
 *  document assertions stay deterministic and the module keeps its no-clock
 *  property. */
const RUN_ID = '3f1d9a8e-0c4b-4b7e-9d21-5c6a7b8e9f01'
const STARTED_AT = '2026-07-26T12:00:00.000Z'

const stateOf = (transcript: CouncilTranscriptEntry[], cancelled = false): CouncilState => ({
  run: RUN,
  transcript,
  cancelled,
  runId: RUN_ID,
  startedAt: STARTED_AT
})

/** A compliant position: one verdict token per question, then prose. */
const position = (v1: string, v2: string, v3: string, prose = 'Because of reasons.'): string =>
  `Q1: ${v1}\nQ2: ${v2}\nQ3: ${v3}\n\n${prose}`

const asks = (actions: readonly CouncilAction[]): Extract<CouncilAction, { kind: 'ask' }>[] =>
  actions.filter((a): a is Extract<CouncilAction, { kind: 'ask' }> => a.kind === 'ask')

/* ------------------------------------------------------------------ */
/* Brief questions — D67 Q3's product constraint                       */
/* ------------------------------------------------------------------ */

describe('parseBriefQuestions — a brief the core cannot diff is a brief it must refuse', () => {
  it('finds numbered questions among prose', () => {
    expect(parseBriefQuestions(BRIEF)).toEqual([
      'Should the widget be blue?',
      'Should the widget be round?',
      'Is the widget necessary at all?'
    ])
  })

  it('tolerates the formatting a human actually writes — list markers, emphasis, ) instead of .', () => {
    const brief = ['- 1) **Is this sound?**', '  2. Does it scale to ten users?'].join('\n')
    expect(parseBriefQuestions(brief)).toEqual(['Is this sound?', 'Does it scale to ten users?'])
  })

  it('finds nothing in a brief of pure prose — which is what makes the refusal fire', () => {
    expect(parseBriefQuestions('Please review the design and tell me what you think.')).toEqual([])
  })

  it('ignores a bare number that is not a question — a version string is not an axis to diff', () => {
    expect(parseBriefQuestions('1. v2')).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* D68(1): the parse is SCOPED to the questions section                */
/*                                                                     */
/* The defect these cover was found by running the shipped parser over */
/* the actual input the milestone names, not by reading anything. The  */
/* two real briefs below are therefore FIXTURES rather than examples.  */
/* ------------------------------------------------------------------ */

const briefsDir = fileURLToPath(new URL('../../../docs/Features/Foundation/CouncilBriefs/', import.meta.url))
const realBrief = (name: string): string => readFileSync(join(briefsDir, name), 'utf8')

describe('⚠ parseBriefQuestions scopes to the questions SECTION (D68(1))', () => {
  const SHAPED_LIKE_A_REAL_BRIEF = [
    '# Council Brief CR-9.9 — Something',
    '',
    '## 4. Binding prior rulings — constraints on your answer, not open questions',
    '',
    '1. Windows-only v1. No transport change is available to you.',
    '2. No second scrubber, and no second pattern list.',
    '',
    '## 7. Evaluation rubric (weigh in this order)',
    '',
    '1. Correctness under a partial run (35%).',
    '2. Cost proportionality — what each round buys, per dollar (15%).',
    '',
    '## 8. Questions for the council',
    '',
    '1. Should the widget be blue, and what does blue cost?',
    '2. Should the widget be round, given the constraint above?',
    '',
    '## 9. Success criteria for this council session',
    '',
    '1. One committed answer per question, or an explicit tie.'
  ].join('\n')

  it('⚠ returns the QUESTIONS and none of the rubric, the rulings or the success criteria', () => {
    expect(parseBriefQuestions(SHAPED_LIKE_A_REAL_BRIEF)).toEqual([
      'Should the widget be blue, and what does blue cost?',
      'Should the widget be round, given the constraint above?'
    ])
  })

  it('⚠ is not fooled by "…not open questions" — the real heading every brief in this repo carries', () => {
    // The subject of that heading is "Binding prior rulings"; the word only
    // appears in the qualifier after the em-dash. A naive /questions/i test
    // matches it and scopes the parse to the ONE section that is explicitly
    // not the questions.
    const parsed = parseBriefQuestions(SHAPED_LIKE_A_REAL_BRIEF)
    expect(parsed.some((q) => q.includes('Windows-only'))).toBe(false)
    expect(parsed.some((q) => q.includes('per dollar'))).toBe(false)
  })

  it('stops at the next heading of the same level, and keeps deeper subsections', () => {
    const brief = [
      '## Questions',
      '',
      '1. The first question, at the top level?',
      '',
      '### A sub-part of the questions',
      '',
      '2. The second question, one level deeper?',
      '',
      '## Appendix',
      '',
      '3. Not a question at all, merely enumerated.'
    ].join('\n')
    expect(parseBriefQuestions(brief)).toEqual([
      'The first question, at the top level?',
      'The second question, one level deeper?'
    ])
  })

  it('falls back to the WHOLE document when there is no questions heading', () => {
    // The synthetic short brief above has no headings at all, and refusing it
    // would refuse the shape a user writes first. Asserted here rather than
    // implied by the cases above.
    expect(parseBriefQuestions(BRIEF)).toHaveLength(3)
  })

  it('⚠ FIXTURE — CouncilBrief-3b.1-DeliberationProtocol.md yields its §8 questions, not §6/§7', () => {
    const parsed = parseBriefQuestions(realBrief('CouncilBrief-3b.1-DeliberationProtocol.md'))
    // Shipped parser, measured 2026-07-26: 21 "questions", none of the first
    // twelve a question. §8 has exactly seven enumerated items.
    expect(parsed).toHaveLength(7)
    expect(parsed[0]).toContain('what "blind" means operationally')
    expect(parsed[5]).toContain('option-fixation check')
    // The three the old parser returned instead, each named so a regression is
    // legible rather than merely a count going up.
    const joined = parsed.join('\n')
    expect(joined).not.toContain('Windows-only v1')
    expect(joined).not.toContain('per dollar')
    expect(joined).not.toContain('Success criteria')
  })

  it('⚠ FIXTURE — CouncilBrief-3b.0-ApiSessionProducer.md yields its §8 questions, not §6/§7', () => {
    const parsed = parseBriefQuestions(realBrief('CouncilBrief-3b.0-ApiSessionProducer.md'))
    expect(parsed.length).toBeGreaterThanOrEqual(4)
    expect(parsed.length).toBeLessThanOrEqual(8)
    const joined = parsed.join('\n')
    expect(joined).not.toContain('Windows-only v1')
    expect(joined).not.toContain('No new npm dependency')
  })
})

/* ------------------------------------------------------------------ */
/* Run assembly                                                        */
/* ------------------------------------------------------------------ */

const candidate = (
  id: string,
  overrides: {
    role?: string
    model?: string | null
    providerModel?: string | null
    authMode?: string
    unavailableSince?: string | null
    baseUrl?: string | null
    missingCredential?: boolean
  } = {}
): AssemblyCandidate => ({
  member: {
    id,
    label: `Member ${id}`,
    credentialProfileId: `cred-${id}`,
    model: overrides.model === undefined ? `vendor/model-${id}` : overrides.model,
    role: overrides.role ?? 'member',
    paramsJson: null
  },
  provider: {
    id: `prov-${id}`,
    name: 'OpenRouter',
    authMode: overrides.authMode ?? 'api_key',
    model: overrides.providerModel ?? null
  },
  credential: overrides.missingCredential
    ? null
    : {
        id: `cred-${id}`,
        providerId: `prov-${id}`,
        label: `Key ${id}`,
        unavailableSince: overrides.unavailableSince ?? null
      },
  baseUrl: overrides.baseUrl === undefined ? GATEWAY : overrides.baseUrl
})

const threeGood = (): AssemblyCandidate[] => [
  candidate('a'),
  candidate('b'),
  candidate('c'),
  candidate('z', { role: 'arbiter' })
]

describe('assembleRun — every refusal is by label, and none is silent', () => {
  it('assembles three members and one arbiter', () => {
    const result = assembleRun(threeGood(), BRIEF, GATEWAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.run.members.map((m) => m.memberId)).toEqual(['a', 'b', 'c'])
    expect(result.run.arbiter.memberId).toBe('z')
  })

  it('refuses ZERO members', () => {
    const result = assembleRun([], BRIEF, GATEWAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('No council members are configured')
  })

  it('refuses ZERO arbiters rather than picking one', () => {
    const result = assembleRun([candidate('a'), candidate('b')], BRIEF, GATEWAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('no arbiter')
  })

  it('refuses TWO arbiters, and names both', () => {
    const result = assembleRun(
      [candidate('a'), candidate('b'), candidate('y', { role: 'arbiter' }), candidate('z', { role: 'arbiter' })],
      BRIEF,
      GATEWAY
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('2 arbiters')
    expect(result.reason).toContain('Member y')
    expect(result.reason).toContain('Member z')
  })

  it('refuses ONE member plus an arbiter — a review, not a council', () => {
    const result = assembleRun([candidate('a'), candidate('z', { role: 'arbiter' })], BRIEF, GATEWAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('at least two members')
  })

  it('⚠ refuses the RUN for an unavailable credential — it never drops the member', () => {
    const candidates = threeGood()
    candidates[1] = candidate('b', { unavailableSince: '2026-07-26T00:00:00.000Z' })
    const result = assembleRun(candidates, BRIEF, GATEWAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('Member b')
  })

  it('⚠ refuses a MANAGEMENT route — the third call site of that refusal (D62)', () => {
    const candidates = threeGood()
    candidates[2] = candidate('c', { authMode: 'management' })
    const result = assembleRun(candidates, BRIEF, GATEWAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('Member c')
    expect(result.reason).toContain('management key')
  })

  it('⚠ refuses a route that cannot use the run’s minted key — never silently falls back', () => {
    const candidates = threeGood()
    candidates[0] = candidate('a', { baseUrl: 'https://api.anthropic.com/v1' })
    const result = assembleRun(candidates, BRIEF, GATEWAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('Member a')
    expect(result.reason).toContain('OpenRouter gateway')
  })

  it('refuses a member with no model and no route default — nothing to ask', () => {
    const candidates = threeGood()
    candidates[0] = candidate('a', { model: null, providerModel: null })
    const result = assembleRun(candidates, BRIEF, GATEWAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('has no model')
  })

  it('inherits the ROUTE’s default model at rank 2 (D56), without persisting it', () => {
    const candidates = threeGood()
    candidates[0] = candidate('a', { model: null, providerModel: 'vendor/route-default' })
    const result = assembleRun(candidates, BRIEF, GATEWAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.run.members[0].model).toBe('vendor/route-default')
  })

  it('⚠ refuses a brief with no numbered questions (D67 Q3)', () => {
    const result = assembleRun(threeGood(), 'Please review this and tell me what you think.', GATEWAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('no numbered questions')
  })
})

describe('routeAcceptsMintedKey — the key authenticates at one gateway and nowhere else', () => {
  it('accepts the gateway, ignoring a trailing slash or a path difference', () => {
    expect(routeAcceptsMintedKey('https://openrouter.ai/api/v1/', GATEWAY)).toBe(true)
    expect(routeAcceptsMintedKey('https://openrouter.ai/api/v2', GATEWAY)).toBe(true)
  })

  it('refuses another host, a null route and an unparseable one — never throwing', () => {
    expect(routeAcceptsMintedKey('https://api.anthropic.com/v1', GATEWAY)).toBe(false)
    expect(routeAcceptsMintedKey(null, GATEWAY)).toBe(false)
    expect(routeAcceptsMintedKey('', GATEWAY)).toBe(false)
    expect(routeAcceptsMintedKey('not a url', GATEWAY)).toBe(false)
  })

  it('⚠ refuses a look-alike host — a prefix match would send a key to someone else', () => {
    expect(routeAcceptsMintedKey('https://openrouter.ai.evil.test/api/v1', GATEWAY)).toBe(false)
    expect(routeAcceptsMintedKey('https://notopenrouter.ai/api/v1', GATEWAY)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Verdict parsing and disagreement detection (D67 Q3)                 */
/* ------------------------------------------------------------------ */

describe('parseVerdicts — a missing token is a QUESTION-level refusal, not a global one', () => {
  it('reads one verdict per question', () => {
    const parsed = parseVerdicts(position('AGREE', 'DISAGREE', 'QUALIFY'))
    expect([...parsed.entries()]).toEqual([
      [0, 'AGREE'],
      [1, 'DISAGREE'],
      [2, 'QUALIFY']
    ])
  })

  it('tolerates emphasis, list markers and lowercase', () => {
    expect(parseVerdicts('- **Q1:** agree').get(0)).toBe('AGREE')
  })

  it('ignores a token that is not in the vocabulary rather than guessing', () => {
    expect(parseVerdicts('Q1: MAYBE').get(0)).toBeUndefined()
  })

  it('⚠ FIRST token wins — a later restatement cannot silently rewrite the answer', () => {
    expect(parseVerdicts('Q1: AGREE\n\nSummary\nQ1: DISAGREE').get(0)).toBe('AGREE')
  })

  it('returns only what parsed when a member answers two of three questions', () => {
    const parsed = parseVerdicts('Q1: AGREE\nQ3: DISAGREE\nprose about Q2')
    expect(parsed.size).toBe(2)
    expect(parsed.get(1)).toBeUndefined()
  })
})

describe('computeDisagreement — structural where it can be, honestly labelled where it cannot', () => {
  const questions = parseBriefQuestions(BRIEF)

  it('reports AGREEMENT when every verdict matches', () => {
    const result = computeDisagreement({
      questions,
      positions: [
        { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
        { memberId: 'm2', content: position('AGREE', 'AGREE', 'AGREE') }
      ]
    })
    expect(result.every((q) => q.path === 'structural')).toBe(true)
    expect(result.every((q) => !q.disagrees)).toBe(true)
  })

  it('reports DISAGREEMENT on exactly the question whose verdicts differ', () => {
    const result = computeDisagreement({
      questions,
      positions: [
        { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
        { memberId: 'm2', content: position('AGREE', 'DISAGREE', 'AGREE') }
      ]
    })
    expect(result.map((q) => q.disagrees)).toEqual([false, true, false])
  })

  it('reports TOTAL disagreement across every question', () => {
    const result = computeDisagreement({
      questions,
      positions: [
        { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
        { memberId: 'm2', content: position('DISAGREE', 'DISAGREE', 'DISAGREE') },
        { memberId: 'm3', content: position('QUALIFY', 'QUALIFY', 'QUALIFY') }
      ]
    })
    expect(result.map((q) => q.disagrees)).toEqual([true, true, true])
    expect(result.every((q) => q.path === 'structural')).toBe(true)
  })

  it('⚠ falls back to model-judged with fewer than two parseable verdicts, and claims NO disagreement there', () => {
    const result = computeDisagreement({
      questions,
      positions: [
        { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
        { memberId: 'm2', content: 'I think it is all fine, honestly.' }
      ]
    })
    expect(result.every((q) => q.path === 'model-judged')).toBe(true)
    // The core did not measure it, so it must not report a measurement.
    expect(result.every((q) => !q.disagrees)).toBe(true)
    expect(result[0].nonCompliant).toEqual(['m2'])
  })

  it('degrades per QUESTION, not per member — a dropped token on Q2 keeps Q1 and Q3 structural', () => {
    const result = computeDisagreement({
      questions,
      positions: [
        { memberId: 'm1', content: 'Q1: AGREE\nQ3: AGREE' },
        { memberId: 'm2', content: 'Q1: DISAGREE\nQ3: AGREE' }
      ]
    })
    expect(result.map((q) => q.path)).toEqual(['structural', 'model-judged', 'structural'])
    expect(result[0].disagrees).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* ⚠ Dissent preservation — the feature's whole value (D67 Q5)         */
/* ------------------------------------------------------------------ */

describe('parseCritiqueSections — a string matcher, deliberately, and its limits are known', () => {
  it('extracts the labelled objection sections', () => {
    const critique = [
      'AGREE: the framing is right',
      'DISAGREE: the cost model assumes streaming',
      'MISSED: nobody considered the empty-answer case',
      'CHANGED: no'
    ].join('\n')
    expect(parseCritiqueSections(critique)).toEqual([
      'the cost model assumes streaming',
      'nobody considered the empty-answer case'
    ])
  })

  it('⚠ finds NOTHING in unlabelled prose — the known limitation, asserted rather than hidden', () => {
    expect(parseCritiqueSections('I disagree with almost all of this, frankly.')).toEqual([])
  })

  it('does not let an objection swallow the agreement paragraph that follows it', () => {
    const critique = 'DISAGREE: the premise is wrong\nAGREE: but the conclusion holds'
    expect(parseCritiqueSections(critique)).toEqual(['the premise is wrong'])
  })
})

describe('extractDissentEntries — the core builds the list, from the transcript', () => {
  const questions = parseBriefQuestions(BRIEF)
  const labelFor = (id: string): string => ({ m1: 'Alpha', m2: 'Beta', m3: 'Gamma' })[id] ?? id

  it('⚠ produces a STRUCTURAL entry for a verdict disagreement, naming who held which position', () => {
    const disagreement = computeDisagreement({
      questions,
      positions: [
        { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
        { memberId: 'm2', content: position('DISAGREE', 'AGREE', 'AGREE') },
        { memberId: 'm3', content: position('AGREE', 'AGREE', 'AGREE') }
      ]
    })
    const entries = extractDissentEntries({ disagreement, transcript: [], labelFor })
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('structural')
    expect(entries[0].source).toBe('Q1')
    expect(entries[0].text).toContain('DISAGREE: Beta')
    expect(entries[0].text).toContain('AGREE: Alpha, Gamma')
  })

  it('produces a CRITIQUE entry from a labelled objection, attributed', () => {
    const entries = extractDissentEntries({
      disagreement: [],
      transcript: [entry('m3', 'critique', 1, 'DISAGREE: the cost model is wrong')],
      labelFor
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('critique')
    expect(entries[0].text).toBe('Gamma: the cost model is wrong')
    // Not 'Critique R1' — the renderer prefixes the path, and the first live
    // run rendered "[Critique — Critique R1]".
    expect(entries[0].source).toBe('R1')
  })

  it('⚠ labels every entry by PROVENANCE — a computed disagreement is not a parsed aside', () => {
    const disagreement = computeDisagreement({
      questions,
      positions: [
        { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
        { memberId: 'm2', content: position('DISAGREE', 'AGREE', 'AGREE') }
      ]
    })
    const entries = extractDissentEntries({
      disagreement,
      transcript: [entry('m2', 'critique', 1, 'MISSED: the empty-answer case')],
      labelFor
    })
    expect(entries.map((e) => e.path)).toEqual(['structural', 'critique'])
  })

  it('produces NO entry when the council genuinely agreed and raised no objection', () => {
    const disagreement = computeDisagreement({
      questions,
      positions: [
        { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
        { memberId: 'm2', content: position('AGREE', 'AGREE', 'AGREE') }
      ]
    })
    expect(
      extractDissentEntries({
        disagreement,
        transcript: [entry('m1', 'critique', 1, 'AGREE: all of it\nCHANGED: no')],
        labelFor
      })
    ).toEqual([])
  })

  it('ignores a REFUSED critique — a turn that never happened has no objection in it', () => {
    const entries = extractDissentEntries({
      disagreement: [],
      transcript: [entry('m1', 'critique', 1, 'DISAGREE: something', 'refused')],
      labelFor
    })
    expect(entries).toEqual([])
  })
})

describe('⚠ the synthesis CANNOT drop a dissent — asserted over the OUTPUT SHAPE, not over prose', () => {
  const questions = parseBriefQuestions(BRIEF)
  const disagreement = computeDisagreement({
    questions,
    positions: [
      { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
      { memberId: 'm2', content: position('DISAGREE', 'AGREE', 'AGREE') },
      { memberId: 'm3', content: position('AGREE', 'AGREE', 'AGREE') }
    ]
  })
  const dissents = extractDissentEntries({
    disagreement,
    transcript: [],
    labelFor: (id) => id
  })

  it('⚠ THE GUARANTEE: an arbiter that says nothing about Q1 still ships Q1’s dissent', () => {
    const doc = assembleFindingsDocument({
      synthesis: 'Everyone agreed. It was a lovely council. No concerns.',
      dissents,
      disagreement,
      run: RUN,
      transcript: [],
      elided: dissentsElided('Everyone agreed. It was a lovely council. No concerns.', dissents),
      runId: RUN_ID,
      startedAt: STARTED_AT
    })
    expect(doc).toContain('## Dissents preserved')
    expect(doc).toContain('[Structural — Q1]')
    expect(doc).toContain('Should the widget be blue?')
  })

  it('records the elision as an OBSERVATION — and D67(b): it is not an abort', () => {
    const synthesis = 'Everyone agreed.'
    expect(dissentsElided(synthesis, dissents)).toEqual(['Q1'])
    const doc = assembleFindingsDocument({
      synthesis,
      dissents,
      disagreement,
      run: RUN,
      transcript: [],
      elided: ['Q1'],
      runId: RUN_ID,
      startedAt: STARTED_AT
    })
    expect(doc).toContain('did not refer to Q1')
    // The run still produced findings. That is the correction's whole point.
    expect(doc).toContain('## Dissents preserved')
  })

  it('reports NO elision when the arbiter engaged with the dissent, wherever it placed it', () => {
    const synthesis = '## Late addendum\n\nOn Q1 I think the minority is right.'
    expect(dissentsElided(synthesis, dissents)).toEqual([])
  })

  it('accepts an empty dissent list ONLY as a statement that agreement was OBSERVED', () => {
    const doc = assembleFindingsDocument({
      synthesis: 'All agreed.',
      dissents: [],
      disagreement,
      run: RUN,
      transcript: [],
      elided: [],
      runId: RUN_ID,
      startedAt: STARTED_AT
    })
    expect(doc).toContain('None — the council was observed to agree')
  })

  it('⚠ publishes HOW each question was detected, so a weak signal cannot pass as a measurement', () => {
    const mixed = computeDisagreement({
      questions,
      positions: [
        { memberId: 'm1', content: 'Q1: AGREE\nQ3: AGREE' },
        { memberId: 'm2', content: 'Q1: DISAGREE\nQ3: AGREE' }
      ]
    })
    const doc = assembleFindingsDocument({
      synthesis: 'x',
      dissents: [],
      disagreement: mixed,
      run: RUN,
      transcript: [],
      elided: [],
      runId: RUN_ID,
      startedAt: STARTED_AT
    })
    expect(doc).toContain('**Q1** — detection: `structural`')
    expect(doc).toContain('**Q2** — detection: `model-judged`')
    expect(doc).toContain('not measured')
  })
})

/* ------------------------------------------------------------------ */
/* F40 — one heading by that name, and the append still unconditional  */
/* ------------------------------------------------------------------ */

describe('F40 — the document carries exactly ONE `## Dissents preserved` (3e-2)', () => {
  const questions = parseBriefQuestions(BRIEF)
  const disagreement = computeDisagreement({
    questions,
    positions: [
      { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
      { memberId: 'm2', content: position('DISAGREE', 'AGREE', 'AGREE') },
      { memberId: 'm3', content: position('AGREE', 'AGREE', 'AGREE') }
    ]
  })
  const dissents = extractDissentEntries({ disagreement, transcript: [], labelFor: (id) => id })

  /** What `grep -c "^## Dissents preserved"` counts in the proving run. */
  const h2Count = (doc: string): number =>
    doc.split('\n').filter((l) => /^## Dissents preserved/.test(l)).length

  const docWith = (synthesis: string, entries = dissents): string =>
    assembleFindingsDocument({
      synthesis,
      dissents: entries,
      disagreement,
      run: RUN,
      transcript: [],
      elided: [],
      runId: RUN_ID,
      startedAt: STARTED_AT
    })

  it('the arbiter wrote the section: exactly one heading, and the core’s lines are STILL THERE', () => {
    const doc = docWith('## Dissents preserved\n\nOn Q1 the minority is right.\n')
    expect(h2Count(doc)).toBe(1)
    // ⚠ THE PROPERTY THAT MATTERS: the append did not stop appending. D67 Q5
    // ruling 5C is a fact about the code, and a heading level cannot be allowed
    // to become a condition on the lines.
    expect(doc).toContain('[Structural — Q1]')
    expect(doc).toContain("### Dissents preserved — the orchestrator's record")
    expect(doc).toContain('generated from the transcript')
  })

  it('the arbiter did NOT write it: the core’s own heading is the one, at level two', () => {
    const doc = docWith('Everyone agreed. It was a lovely council.')
    expect(h2Count(doc)).toBe(1)
    expect(doc).toContain('## Dissents preserved')
    expect(doc).not.toContain("### Dissents preserved — the orchestrator's record")
    expect(doc).toContain('[Structural — Q1]')
  })

  it('the EMPTY branch is one heading too, both ways', () => {
    expect(h2Count(docWith('All agreed.', []))).toBe(1)
    const withArbiterSection = docWith('## Dissents preserved\n\nNothing to preserve.\n', [])
    expect(h2Count(withArbiterSection)).toBe(1)
    expect(withArbiterSection).toContain('None — the council was observed to agree')
  })

  it('⚠ ANCHORED: the phrase in PROSE is not a heading and must not demote the only copy', () => {
    expect(synthesisCarriesDissentHeading('As the dissents preserved section shows, Q1 stands.')).toBe(
      false
    )
    const doc = docWith('As the dissents preserved section shows, Q1 stands.')
    expect(h2Count(doc)).toBe(1)
    expect(doc).toContain('## Dissents preserved')
  })

  it('a DEEPER heading in the synthesis is not a peer, so the core still owns the level-two one', () => {
    expect(synthesisCarriesDissentHeading('### Dissents preserved\n\nmine\n')).toBe(false)
    expect(h2Count(docWith('### Dissents preserved\n\nmine\n'))).toBe(1)
  })

  it('trailing text on the heading line still counts as the arbiter opening the section', () => {
    expect(synthesisCarriesDissentHeading('## Dissents preserved (and my reading of them)')).toBe(true)
    expect(synthesisCarriesDissentHeading('## dissents PRESERVED')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* The dissent matcher's noise — precision only, recall untouched      */
/* ------------------------------------------------------------------ */

describe('statesNoObjection — precision may improve, recall may NOT be spent on it (3e-2)', () => {
  it('drops the mechanically certain non-objections', () => {
    for (const body of ['None', 'none.', 'N/A', 'nil', 'Nothing', ' no ', 'No objections', 'Agreed']) {
      expect(statesNoObjection(body)).toBe(true)
    }
  })

  it('⚠ KEEPS anything it cannot be certain about — whole body, never a prefix', () => {
    for (const body of [
      'None of the three addressed back-pressure',
      'Nothing substantive, though the cap is unargued',
      'No — the refusal path swallows the byte count',
      'I agree with Beta but not with Gamma',
      'agreed on Q1, but Q2 is unaddressed'
    ]) {
      expect(statesNoObjection(body)).toBe(false)
    }
  })

  it('a DISAGREE label whose body says nothing yields no dissent; one that says something does', () => {
    expect(parseCritiqueSections('DISAGREE: None\nAGREE: all of it')).toEqual([])
    expect(parseCritiqueSections('DISAGREE: none')).toEqual([])
    expect(parseCritiqueSections('DISAGREE: None of the three addressed back-pressure')).toEqual([
      'None of the three addressed back-pressure'
    ])
  })

  it('⚠ the drop is the LABEL, not the objection — a real dissent beside a hollow one survives', () => {
    expect(
      parseCritiqueSections(['DISAGREE: none', 'MISSED: the empty-answer case', 'AGREE: rest'].join('\n'))
    ).toEqual(['the empty-answer case'])
  })
})

describe('dissent attribution — six-from-one reads as six-from-one (3e-2, spec §2)', () => {
  const questions = parseBriefQuestions(BRIEF)
  const disagreement = computeDisagreement({
    questions,
    positions: [
      { memberId: 'm1', content: position('AGREE', 'AGREE', 'AGREE') },
      { memberId: 'm2', content: position('DISAGREE', 'AGREE', 'AGREE') },
      { memberId: 'm3', content: position('AGREE', 'AGREE', 'AGREE') }
    ]
  })
  const labelFor = (id: string): string => ({ m1: 'Alpha', m2: 'Beta', m3: 'Gamma' })[id] ?? id
  const talkative = entry(
    'm2',
    'critique',
    1,
    ['DISAGREE: one', 'DISAGREE: two', 'DISAGREE: three', 'DISAGREE: four', 'DISAGREE: five', 'DISAGREE: six'].join(
      '\n'
    )
  )

  it('names the member and the count instead of letting six lines imply breadth', () => {
    const dissents = extractDissentEntries({
      disagreement,
      transcript: [talkative, entry('m3', 'critique', 1, 'MISSED: the cap is unargued')],
      labelFor
    })
    const doc = assembleFindingsDocument({
      synthesis: 'Findings.',
      dissents,
      disagreement,
      run: RUN,
      transcript: [],
      elided: [],
      runId: RUN_ID,
      startedAt: STARTED_AT
    })
    expect(doc).toContain('8 preserved: 1 structural')
    expect(doc).toContain('7 from critique prose, from 2 members — Beta 6 · Gamma 1')
    expect(doc).toContain('Read the per-member split before reading breadth into the total')
    // ⚠ NOTHING WAS DROPPED TO MAKE THE TOTAL SMALLER — all seven lines are here.
    expect(doc.split('\n').filter((l) => l.startsWith('- [Critique')).length).toBe(7)
  })

  it('an empty dissent list attributes nothing rather than rendering a zero', () => {
    const doc = assembleFindingsDocument({
      synthesis: 'Findings.',
      dissents: [],
      disagreement,
      run: RUN,
      transcript: [],
      elided: [],
      runId: RUN_ID,
      startedAt: STARTED_AT
    })
    expect(doc).not.toContain('preserved: 0 structural')
    expect(doc).toContain('None — the council was observed to agree')
  })
})

describe('⚠ a partial run reads as partial (D67 Q6)', () => {
  it('headlines the count and names who refused, at which phase', () => {
    const transcript = [
      entry('m1', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      entry('m2', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      entry('m3', 'positions', 0, 'The response stream failed.', 'refused')
    ]
    const doc = assembleFindingsDocument({
      synthesis: 'Findings.',
      dissents: [],
      disagreement: [],
      run: RUN,
      transcript,
      elided: [],
      runId: RUN_ID,
      startedAt: STARTED_AT
    })
    expect(doc).toContain('PARTIAL RUN — 2 of 3 members completed')
    expect(doc).toContain('Gamma')
    expect(doc).toContain('refused at **positions**')
    expect(doc).toContain('did not fully convene')
  })

  it('says so plainly when the council was whole — never silently', () => {
    const transcript = RUN.members.map((m) =>
      entry(m.memberId, 'positions', 0, position('AGREE', 'AGREE', 'AGREE'))
    )
    const doc = assembleFindingsDocument({
      synthesis: 'Findings.',
      dissents: [],
      disagreement: [],
      run: RUN,
      transcript,
      elided: [],
      runId: RUN_ID,
      startedAt: STARTED_AT
    })
    expect(doc).toContain('All members completed')
    expect(doc).not.toContain('PARTIAL RUN')
  })
})

/* ------------------------------------------------------------------ */
/* D68(2): the two things the document must carry and did not          */
/* ------------------------------------------------------------------ */

describe('⚠ the findings document carries PROVENANCE and the STANDING CAVEAT (D68(2))', () => {
  const transcript = [
    entry('m1', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
    entry('m2', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
    entry('m3', 'positions', 0, 'The response stream failed.', 'refused'),
    entry('arb', 'synthesis', 3, 'Findings.')
  ]
  const doc = (): string =>
    assembleFindingsDocument({
      synthesis: 'Findings.',
      dissents: [],
      disagreement: [],
      run: RUN,
      transcript,
      elided: [],
      runId: RUN_ID,
      startedAt: STARTED_AT
    })

  it('names the run id and the time it started', () => {
    expect(doc()).toContain(RUN_ID)
    expect(doc()).toContain(STARTED_AT)
  })

  it('⚠ names EVERY member and the model it ran on, arbiter included', () => {
    const out = doc()
    for (const m of [...RUN.members, RUN.arbiter]) {
      expect(out).toContain(m.label)
      expect(out).toContain(m.model)
    }
    expect(out).toContain('| Gamma | member | `vendor/model-m3` | refused 1 turn |')
    expect(out).toContain('| Arbiter | arbiter | `vendor/model-arb` | answered 1 turn |')
  })

  it('⚠ says the findings are DELIBERATION, not verified fact — spec §3.2, and it is mandatory', () => {
    // Asserted structurally over the produced document rather than by reading
    // prose: a later reader citing a findings file as verification is exactly
    // what this sentence exists to stop, and CR-3b.0's four compile errors are
    // the standing evidence that it happens.
    expect(doc()).toContain('model deliberation, not verified fact')
  })

  it('⚠ places the caveat ABOVE the synthesis — a caveat after the conclusions arrives too late', () => {
    const out = doc()
    expect(out.indexOf('model deliberation, not verified fact')).toBeLessThan(out.indexOf('## Provenance'))
    expect(out.indexOf('model deliberation, not verified fact')).toBeLessThan(
      out.indexOf('## How disagreement was detected')
    )
  })

  it('never claims the deliberation was verified, checked or safe', () => {
    expect(doc()).not.toMatch(/\b(verified by|safe)\b/i)
  })
})

/* ------------------------------------------------------------------ */
/* nextAction — the state machine, phase by phase                      */
/* ------------------------------------------------------------------ */

const allPositions = (): CouncilTranscriptEntry[] =>
  RUN.members.map((m) => entry(m.memberId, 'positions', 0, position('AGREE', 'AGREE', 'AGREE')))

const allCritiques = (): CouncilTranscriptEntry[] =>
  RUN.members.map((m) => entry(m.memberId, 'critique', 1, 'AGREE: yes\nCHANGED: no'))

describe('nextAction — phase 1: blind positions', () => {
  it('⚠ asks EVERY member in ONE batch — which is what makes the round blind', () => {
    const actions = nextAction(stateOf([]))
    expect(asks(actions)).toHaveLength(3)
    expect(asks(actions).map((a) => a.memberId)).toEqual(['m1', 'm2', 'm3'])
    expect(asks(actions).every((a) => a.phase === 'positions' && a.round === 0)).toBe(true)
  })

  it('⚠ does NOT ask the arbiter in the blind round', () => {
    expect(asks(nextAction(stateOf([]))).some((a) => a.memberId === 'arb')).toBe(false)
  })

  it('gives every member the SAME prompt, carrying the brief and the verdict vocabulary', () => {
    const prompts = new Set(asks(nextAction(stateOf([]))).map((a) => a.prompt))
    expect(prompts.size).toBe(1)
    const prompt = [...prompts][0]
    expect(prompt).toContain('Should the widget be blue?')
    expect(prompt).toContain('Q1: AGREE')
    expect(prompt).toContain('answering BLIND')
  })

  it('⚠ no member’s prompt can contain another member’s answer — none of them exists yet', () => {
    for (const ask of asks(nextAction(stateOf([])))) {
      expect(ask.prompt).not.toContain('Because of reasons.')
    }
  })
})

describe('nextAction — phase 2: anonymised critique', () => {
  it('asks each member that answered, and shows them the others', () => {
    const actions = asks(nextAction(stateOf(allPositions())))
    expect(actions).toHaveLength(3)
    expect(actions.every((a) => a.phase === 'critique' && a.round === 1)).toBe(true)
  })

  it('⚠ STRIPS every label from the critique prompt (D67 Q1, ruling 1B)', () => {
    const actions = asks(nextAction(stateOf(allPositions())))
    for (const ask of actions) {
      for (const label of ['Alpha', 'Beta', 'Gamma', 'Arbiter']) {
        expect(ask.prompt).not.toContain(label)
      }
      // …and the model ids are absent too, which is the other way to identify a peer.
      expect(ask.prompt).not.toContain('vendor/model-')
      expect(ask.prompt).toContain('Position A')
    }
  })

  it('⚠ never shows a member its OWN position back as somebody else’s', () => {
    const transcript = [
      entry('m1', 'positions', 0, 'Q1: AGREE\nUNIQUE-ALPHA-TEXT'),
      entry('m2', 'positions', 0, 'Q1: AGREE\nUNIQUE-BETA-TEXT'),
      entry('m3', 'positions', 0, 'Q1: AGREE\nUNIQUE-GAMMA-TEXT')
    ]
    const forM1 = asks(nextAction(stateOf(transcript))).find((a) => a.memberId === 'm1')
    expect(forM1?.prompt).not.toContain('UNIQUE-ALPHA-TEXT')
    expect(forM1?.prompt).toContain('UNIQUE-BETA-TEXT')
    expect(forM1?.prompt).toContain('UNIQUE-GAMMA-TEXT')
  })

  it('excludes a REFUSED member from the critique round without aborting the run', () => {
    const transcript = [
      entry('m1', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      entry('m2', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      entry('m3', 'positions', 0, 'The response stream failed.', 'refused')
    ]
    const actions = asks(nextAction(stateOf(transcript)))
    expect(actions.map((a) => a.memberId)).toEqual(['m1', 'm2'])
  })
})

describe('nextAction — phase 3: arbitration, which ALWAYS runs (D67 Q4, ruling 4A)', () => {
  it('asks the arbiter alone', () => {
    const actions = nextAction(stateOf([...allPositions(), ...allCritiques()]))
    expect(asks(actions)).toHaveLength(1)
    expect(asks(actions)[0].memberId).toBe('arb')
    expect(asks(actions)[0].phase).toBe('arbitration')
  })

  it('⚠ RUNS ON UNANIMITY, and asks whether the agreement is warranted', () => {
    const actions = asks(nextAction(stateOf([...allPositions(), ...allCritiques()])))
    expect(actions[0].prompt).toContain('members AGREED on every measured question')
    expect(actions[0].prompt).toContain('what the council collectively missed')
  })

  it('asks the arbiter to RULE when the members disagreed', () => {
    const transcript = [
      entry('m1', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      entry('m2', 'positions', 0, position('DISAGREE', 'AGREE', 'AGREE')),
      entry('m3', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      ...allCritiques()
    ]
    const actions = asks(nextAction(stateOf(transcript)))
    expect(actions[0].prompt).toContain('which position is better supported')
    expect(actions[0].prompt).toContain('if the minority position is right, say so')
  })

  it('⚠ shows the arbiter attributed positions — it is not in the blind round', () => {
    const actions = asks(nextAction(stateOf([...allPositions(), ...allCritiques()])))
    expect(actions[0].prompt).toContain('Alpha — position')
    expect(actions[0].prompt).toContain('Beta — critique')
  })

  it('carries the MEASURED vector, labelled as a count rather than an opinion', () => {
    const actions = asks(nextAction(stateOf([...allPositions(), ...allCritiques()])))
    expect(actions[0].prompt).toContain('What the orchestrator MEASURED')
    expect(actions[0].prompt).toContain('Q1: members agree')
  })
})

describe('nextAction — phase 4: synthesis, and completion', () => {
  const throughArbitration = (): CouncilTranscriptEntry[] => [
    ...allPositions(),
    ...allCritiques(),
    entry('arb', 'arbitration', 2, 'My ruling: it is fine.')
  ]

  it('asks the arbiter to synthesize, handing it the core’s dissent list', () => {
    const actions = asks(nextAction(stateOf(throughArbitration())))
    expect(actions[0].phase).toBe('synthesis')
    expect(actions[0].prompt).toContain('Dissents preserved')
    expect(actions[0].prompt).toContain('You MUST NOT drop one')
  })

  it('completes with the assembled document once the synthesis lands', () => {
    const actions = nextAction(
      stateOf([...throughArbitration(), entry('arb', 'synthesis', 3, '## Council synthesis\n\nAll good.')])
    )
    expect(actions).toHaveLength(1)
    expect(actions[0].kind).toBe('complete')
    if (actions[0].kind !== 'complete') return
    expect(actions[0].findings).toContain('All good.')
    expect(actions[0].findings).toContain('## Dissents preserved')
    expect(actions[0].findings).toContain('How disagreement was detected')
  })
})

describe('nextAction — the abort paths, each one a rule rather than an improvisation', () => {
  it('aborts on cancellation, before anything else is considered', () => {
    const actions = nextAction(stateOf(allPositions(), true))
    expect(actions).toEqual([{ kind: 'abort', reason: 'The run was cancelled.' }])
  })

  it('⚠ aborts when refusals drop the council below two answering members (D67 Q6)', () => {
    const transcript = [
      entry('m1', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      entry('m2', 'positions', 0, 'failed', 'refused'),
      entry('m3', 'positions', 0, 'failed', 'refused')
    ]
    const actions = nextAction(stateOf(transcript))
    expect(actions[0].kind).toBe('abort')
    if (actions[0].kind !== 'abort') return
    expect(actions[0].reason).toContain('Only 1 of 3 members answered')
  })

  it('CONTINUES at exactly two — the floor is a floor, not a margin', () => {
    const transcript = [
      entry('m1', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      entry('m2', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      entry('m3', 'positions', 0, 'failed', 'refused')
    ]
    expect(nextAction(stateOf(transcript))[0].kind).toBe('ask')
  })

  it('aborts when EVERY member refuses', () => {
    const transcript = RUN.members.map((m) => entry(m.memberId, 'positions', 0, 'failed', 'refused'))
    expect(nextAction(stateOf(transcript))[0].kind).toBe('abort')
  })

  it('⚠ aborts when the ARBITER refuses at arbitration — there is no fallback arbiter', () => {
    const transcript = [
      ...allPositions(),
      ...allCritiques(),
      entry('arb', 'arbitration', 2, 'stream failed', 'refused')
    ]
    const actions = nextAction(stateOf(transcript))
    expect(actions[0].kind).toBe('abort')
    if (actions[0].kind !== 'abort') return
    expect(actions[0].reason).toContain('arbiter refused at arbitration')
  })

  it('aborts when the arbiter refuses at SYNTHESIS, after a good deliberation', () => {
    const transcript = [
      ...allPositions(),
      ...allCritiques(),
      entry('arb', 'arbitration', 2, 'ruling'),
      entry('arb', 'synthesis', 3, 'stream failed', 'refused')
    ]
    const actions = nextAction(stateOf(transcript))
    expect(actions[0].kind).toBe('abort')
    if (actions[0].kind !== 'abort') return
    expect(actions[0].reason).toContain('arbiter refused at synthesis')
  })

  it('⚠ does NOT abort when the arbiter elided a dissent — D67 correction (b)', () => {
    const transcript = [
      entry('m1', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      entry('m2', 'positions', 0, position('DISAGREE', 'AGREE', 'AGREE')),
      entry('m3', 'positions', 0, position('AGREE', 'AGREE', 'AGREE')),
      ...allCritiques(),
      entry('arb', 'arbitration', 2, 'ruling'),
      entry('arb', 'synthesis', 3, 'Everyone agreed and there is nothing more to say.')
    ]
    const actions = nextAction(stateOf(transcript))
    // A completed, fully-paid-for run is NOT discarded over a string check.
    expect(actions[0].kind).toBe('complete')
    if (actions[0].kind !== 'complete') return
    expect(actions[0].findings).toContain('did not refer to Q1')
    expect(actions[0].findings).toContain('[Structural — Q1]')
  })
})

describe('nextAction — purity', () => {
  it('⚠ is a FUNCTION OF THE STATE ALONE — same state in, same actions out (D67 correction (c))', () => {
    const state = stateOf([...allPositions(), ...allCritiques()])
    expect(nextAction(state)).toEqual(nextAction(state))
  })

  it('never mutates the state it was handed', () => {
    const transcript = allPositions()
    const snapshot = JSON.stringify(transcript)
    nextAction(stateOf(transcript))
    expect(JSON.stringify(transcript)).toBe(snapshot)
  })
})

/* ------------------------------------------------------------------ */
/* Cost accounting — D55's denominator                                 */
/* ------------------------------------------------------------------ */

describe('computeRunAccounting — no number without its denominator (D55)', () => {
  it('counts answered, refused, and usage reported versus absent', () => {
    const result = computeRunAccounting({
      membersPlanned: 4,
      turns: [
        { memberId: 'm1', outcome: 'answered', usage: { tokensIn: 100, tokensOut: 50, tokensCached: 0 } },
        { memberId: 'm2', outcome: 'answered', usage: { tokensIn: 200, tokensOut: 60, tokensCached: null } },
        { memberId: 'm3', outcome: 'refused', usage: null }
      ]
    })
    expect(result).toEqual({
      membersPlanned: 4,
      membersAnswered: 2,
      membersRefused: 1,
      turnsAnswered: 2,
      turnsRefused: 1,
      usageReported: 2,
      usageAbsent: 1,
      tokensIn: 300,
      tokensOut: 110,
      tokensCached: 0
    })
  })

  it('⚠ leaves the totals NULL when NOBODY reported usage — never a tidy zero', () => {
    const result = computeRunAccounting({
      membersPlanned: 2,
      turns: [
        { memberId: 'm1', outcome: 'answered', usage: null },
        { memberId: 'm2', outcome: 'answered', usage: null }
      ]
    })
    expect(result.tokensIn).toBeNull()
    expect(result.tokensOut).toBeNull()
    expect(result.usageAbsent).toBe(2)
    // The denominator still ships, which is the whole point.
    expect(result.membersAnswered).toBe(2)
  })

  it('⚠ distinguishes a REAL zero from an absent one', () => {
    const result = computeRunAccounting({
      membersPlanned: 1,
      turns: [{ memberId: 'm1', outcome: 'answered', usage: { tokensIn: 0, tokensOut: 0, tokensCached: 0 } }]
    })
    expect(result.tokensIn).toBe(0)
    expect(result.usageReported).toBe(1)
    expect(result.usageAbsent).toBe(0)
  })

  it('keeps a partially-reported total rather than discarding the fields that did arrive', () => {
    const result = computeRunAccounting({
      membersPlanned: 2,
      turns: [
        { memberId: 'm1', outcome: 'answered', usage: { tokensIn: 10, tokensOut: null, tokensCached: null } },
        { memberId: 'm2', outcome: 'answered', usage: { tokensIn: 20, tokensOut: 5, tokensCached: null } }
      ]
    })
    expect(result.tokensIn).toBe(30)
    expect(result.tokensOut).toBe(5)
    expect(result.tokensCached).toBeNull()
  })

  it('⚠ counts MEMBERS distinctly from TURNS — the defect a live drive found', () => {
    // The first build reported `membersAnswered: 8` for a four-member council,
    // because it counted turns. Eight of four is not a denominator.
    const result = computeRunAccounting({
      membersPlanned: 4,
      turns: [
        { memberId: 'm1', outcome: 'answered', usage: null },
        { memberId: 'm1', outcome: 'answered', usage: null },
        { memberId: 'm2', outcome: 'answered', usage: null },
        { memberId: 'm2', outcome: 'refused', usage: null }
      ]
    })
    expect(result.membersAnswered).toBe(2)
    expect(result.turnsAnswered).toBe(3)
    // m2 both answered and refused — two questions, not two halves of one.
    expect(result.membersRefused).toBe(1)
    expect(result.turnsRefused).toBe(1)
  })

  it('is inert on an empty run', () => {
    const result = computeRunAccounting({ membersPlanned: 0, turns: [] })
    expect(result.membersAnswered).toBe(0)
    expect(result.tokensIn).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  describeArchive,
  describeHide,
  describeProjectDeletion,
  describeReactivation
} from './projectLifecycle'

const none = { sessions: 0, worktrees: 0, councilRuns: 0, transcriptTurns: 0 }

/**
 * These sentences are the reason `projectLifecycle.ts` is a module and not a
 * template. The repo has no `.vue` tests, so anything assembled in a view is
 * unreachable by this suite — and the delete confirmation is the one string in
 * the app where being wrong costs the user data.
 */
describe('describeProjectDeletion', () => {
  it('names the project — never "this project"', () => {
    const s = describeProjectDeletion('Chorus', { ...none, sessions: 2 })
    expect(s).toContain('Chorus')
    expect(s).not.toContain('this project')
  })

  it('states every non-zero count, joined the way a person would', () => {
    const s = describeProjectDeletion('Chorus', {
      sessions: 4,
      worktrees: 2,
      councilRuns: 3,
      transcriptTurns: 57
    })
    expect(s).toContain('4 sessions')
    expect(s).toContain('2 worktrees')
    expect(s).toContain('3 council runs')
    expect(s).toContain('57 transcript turns')
    // "a, b, c and d" — not a bare comma list, and not an Oxford comma.
    expect(s).toContain('4 sessions, 2 worktrees, 3 council runs and 57 transcript turns')
  })

  it('gets every singular right', () => {
    const s = describeProjectDeletion('Chorus', {
      sessions: 1,
      worktrees: 1,
      councilRuns: 1,
      transcriptTurns: 1
    })
    expect(s).toContain('1 session')
    expect(s).not.toContain('1 sessions')
    expect(s).toContain('1 worktree,')
    expect(s).not.toContain('1 worktrees')
    expect(s).toContain('1 council run')
    expect(s).not.toContain('1 council runs')
    expect(s).toContain('1 transcript turn')
    expect(s).not.toContain('1 transcript turns')
  })

  /* D76: a zero is not a fact the user needs here. Four of them would bury the
     one number that matters in the dialog whose entire job is to state it. */
  it('omits zero clauses rather than printing "0 sessions"', () => {
    const s = describeProjectDeletion('Chorus', { ...none, sessions: 3 })
    expect(s).toContain('3 sessions')
    expect(s).not.toContain('0 worktrees')
    expect(s).not.toContain('0 council runs')
    expect(s).not.toContain('0 transcript turns')
    expect(s).not.toContain(' 0 ')
  })

  it('still says something honest when there is nothing recorded at all', () => {
    const s = describeProjectDeletion('Fresh', none)
    expect(s).toContain('Fresh')
    expect(s).toContain('nothing else recorded')
    expect(s).not.toContain(' 0 ')
  })

  /**
   * ⚠ THE CLAUSE THE WHOLE MODULE EXISTS FOR (D121). "Delete project" is a
   * phrase a reasonable person reads as "delete my work". Only saying otherwise
   * fixes that, and it has to be its own sentence — a subordinate clause at the
   * end of a sentence about deletion is the part that gets skimmed.
   */
  it('states what SURVIVES, in its own sentence: the folder on disk', () => {
    const s = describeProjectDeletion('Chorus', { ...none, sessions: 2 })
    expect(s).toContain('Your project folder on disk is left exactly as it is.')
  })

  /* D124: the worktree ROWS go, the DIRECTORIES and BRANCHES stay. This is the
     one count where "we deleted the row" and "we deleted your work" could be
     confused, so the sentence names the number and says Chorus stops tracking. */
  it('names the worktree folders as surviving, and says Chorus stops tracking them', () => {
    const many = describeProjectDeletion('Chorus', { ...none, worktrees: 3 })
    expect(many).toContain('3 worktree folders and branches')
    expect(many).toContain('stops tracking them')

    const one = describeProjectDeletion('Chorus', { ...none, worktrees: 1 })
    expect(one).toContain('worktree folder and branch')
    expect(one).not.toContain('1 worktree folders')
  })

  it('states irreversibility', () => {
    expect(describeProjectDeletion('Chorus', none)).toContain('cannot be undone')
    expect(describeProjectDeletion('Chorus', { ...none, sessions: 9 })).toContain(
      'cannot be undone'
    )
  })
})

describe('describeArchive', () => {
  it('names the project and what archiving costs', () => {
    const s = describeArchive('Chorus', 0)
    expect(s).toContain('Chorus')
    expect(s).toContain('cannot be launched into')
    expect(s).toContain('will not come back at startup')
  })

  /* Archive is the one REVERSIBLE action with an IRREVERSIBLE side effect: the
     status flips back on request, the stopped agents do not come back with it. */
  it('names the number of running agents it will stop, with the right plural', () => {
    expect(describeArchive('Chorus', 1)).toContain('stops 1 running agent')
    expect(describeArchive('Chorus', 1)).not.toContain('1 running agents')
    expect(describeArchive('Chorus', 4)).toContain('stops 4 running agents')
  })

  it('says nothing about stopping agents when there are none — no "0 running agents"', () => {
    const s = describeArchive('Chorus', 0)
    expect(s).not.toContain('running agent')
    expect(s).not.toContain(' 0 ')
  })

  it('promises the data is kept and the action is reversible', () => {
    const s = describeArchive('Chorus', 2)
    expect(s).toContain('kept')
    expect(s).toContain('unarchive it at any time')
  })
})

describe('describeHide', () => {
  /**
   * ⚠ THE CONTRAST WITH ARCHIVE IS THE WHOLE SENTENCE. Two controls next to
   * each other, one of which stops the user's agents and one of which does not,
   * is exactly the pair a person picks wrongly.
   */
  it('says explicitly that nothing else changes — the contrast with archive', () => {
    const s = describeHide('Chorus')
    expect(s).toContain('Chorus')
    expect(s).toContain('nothing else changes')
    expect(s).toContain('agents keep running')
    expect(s).toContain('still come back at startup')
  })

  it('says the project stays reachable in the palette, and is reversible', () => {
    const s = describeHide('Chorus')
    expect(s).toContain('command palette')
    expect(s).toContain('unhide it at any time')
  })

  it('never claims to stop anything', () => {
    expect(describeHide('Chorus')).not.toContain('stops')
  })
})

/**
 * The sentence `reactivated_from` exists to carry (F45). Without a consumer that
 * field is a fact main computes and nobody reads — and the user's "Add project"
 * click silently pulls something out of their archive instead.
 */
describe('describeReactivation', () => {
  it('names the project and says where it came back from', () => {
    expect(describeReactivation('Chorus', 'archived')).toBe(
      'Unarchived Chorus — it was in your archive.'
    )
    expect(describeReactivation('Chorus', 'hidden')).toContain('Chorus')
    expect(describeReactivation('Chorus', 'hidden')).toContain('hidden')
  })

  /* The two states must not read alike: one of them stopped the user's agents
     and the other did not, and the toast is the only place the difference is
     stated at this moment. */
  it('distinguishes the two states rather than saying "restored" for both', () => {
    expect(describeReactivation('Chorus', 'archived')).not.toBe(
      describeReactivation('Chorus', 'hidden')
    )
    expect(describeReactivation('Chorus', 'hidden')).not.toContain('archive')
  })

  /* ⚠ A HARD LENGTH BUDGET, because App's toast clears after 2.5 SECONDS. A
     sentence that cannot be read in that window is decoration, and this is the
     only notice the user gets that their click did something other than add. */
  it('stays short enough to read inside the toast’s 2.5s life', () => {
    for (const from of ['archived', 'hidden'] as const) {
      expect(describeReactivation('Chorus', from).length).toBeLessThanOrEqual(60)
    }
    // Even a long project name must not push it into paragraph territory.
    expect(describeReactivation('A-Very-Long-Project-Name-Indeed', 'archived').length)
      .toBeLessThanOrEqual(90)
  })

  it('does not restate what archive did to the agents — the workspace shows that', () => {
    const s = describeReactivation('Chorus', 'archived')
    expect(s).not.toContain('relaunch')
    expect(s).not.toContain('agent')
  })
})

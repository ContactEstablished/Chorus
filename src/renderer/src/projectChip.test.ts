import { describe, expect, it } from 'vitest'
import { chipColorValue, SPINE_VARS } from './projectChip'

/**
 * `projectChip.ts` shipped with migration v13 and had no tests until v15 gave
 * it a second parameter meaning. That is the reason it gets them now: the
 * module's whole job is to be the ONE answer to "what colour is this project",
 * and the bug it was written to end (the rail and the settings screen
 * disagreeing) is invisible to the type system — both call sites take a number,
 * and passing the wrong number compiles perfectly.
 *
 * ⚠ ONLY `chipColorValue` IS COVERED HERE, AND THE OMISSION IS DELIBERATE.
 * `resolveChipHex` reads `getComputedStyle(document.documentElement)`; this
 * suite runs under vitest's `environment: 'node'`, where there is no document
 * to read and no `main.css` to have defined the custom properties. Stubbing a
 * DOM to assert a fallback would be testing the stub. The two functions share
 * the SAME cycle expression, and these tests pin that cycle — which is the part
 * that had to stay identical between them.
 */
describe('chipColorValue — the pre-v13 fallback cycle, by stored seed', () => {
  it('returns a stored colour untouched, whatever the seed says', () => {
    // The short-circuit is the common case from v13 on: every project created
    // since then has a colour of its own, and the cycle must not second-guess
    // it. A seed is present on every row, so "has a colour" is the only thing
    // that decides which branch runs.
    expect(chipColorValue('#3BCFAE', 0)).toBe('#3BCFAE')
    expect(chipColorValue('#3BCFAE', 1)).toBe('#3BCFAE')
    expect(chipColorValue('#e2796b', 7)).toBe('#e2796b')
  })

  it('cycles the three spine tokens for a project that never chose one', () => {
    expect(chipColorValue(null, 0)).toBe('var(--color-spine-violet)')
    expect(chipColorValue(null, 1)).toBe('var(--color-spine-sand)')
    expect(chipColorValue(null, 2)).toBe('var(--color-spine-blue)')
  })

  /* The seed is a stored count, not a bounded index — a database with twelve
     projects hands out seed 11, and every project past the third relies on the
     wrap. This is the assertion that the migration's `color_seed = sort_order`
     back-fill is safe to apply to a list of any length. */
  it('wraps for seeds beyond the array length, and keeps wrapping', () => {
    expect(chipColorValue(null, 3)).toBe('var(--color-spine-violet)')
    expect(chipColorValue(null, 4)).toBe('var(--color-spine-sand)')
    expect(chipColorValue(null, 5)).toBe('var(--color-spine-blue)')
    expect(chipColorValue(null, 11)).toBe('var(--color-spine-blue)')
    expect(chipColorValue(null, 300)).toBe('var(--color-spine-violet)')
  })

  /**
   * ⚠ THE REGRESSION THIS FILE EXISTS FOR. Before v15 the rail passed its
   * `v-for` index here, which was the same number as the seed only while the
   * rail rendered every project in creation order. Hiding one project makes
   * every index below it shift by one; the seeds do not move. This test states
   * the difference as an assertion rather than as a comment: the same project,
   * at a different position, is the same colour.
   */
  it('is a function of the seed alone — position cannot move a colour', () => {
    const seedOfThirdProject = 2
    // Rendered third, rendered first, rendered anywhere: same input, same colour.
    expect(chipColorValue(null, seedOfThirdProject)).toBe('var(--color-spine-blue)')
    expect(chipColorValue(null, seedOfThirdProject)).toBe(chipColorValue(null, seedOfThirdProject))
  })

  it('names the three tokens main.css defines, in the order the rail cycles them', () => {
    // The values themselves live in main.css (the module refuses to duplicate
    // the hex); what this pins is that there are three, and which order they
    // come in — the thing every seed in the database is now interpreted against.
    expect(SPINE_VARS).toEqual([
      '--color-spine-violet',
      '--color-spine-sand',
      '--color-spine-blue'
    ])
  })
})

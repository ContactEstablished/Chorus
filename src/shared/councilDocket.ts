/**
 * The Docket's user-facing wording (D109/D112), shared because the renderer
 * shows it and it must be testable without a browser.
 *
 * ⚠ NOT IN `councilDocketCore.ts`, which imports the database row types and is
 * therefore main-only. The precedent for a pure helper both sides may import is
 * `projectColors.ts` / `layout.ts`.
 *
 * ⚠ AND NOT ASSEMBLED IN THE VIEW. The whole point of D109 is that the user is
 * told the size of what they are about to delete BEFORE they delete it;
 * interpolating that sentence into a template in a `.vue` file would make the one
 * sentence that has to be right the one sentence nothing checks.
 */

/**
 * What "Remove from Docket" is about to purge, stated before it is taken.
 *
 * ⚠ IT NAMES ONLY THE DATABASE, AND IT SAYS SO OUT LOUD. The `-Findings.md`
 * document sits beside the user's own brief in the user's own repository —
 * Chorus did not create that folder and does not delete from it. A confirm that
 * said "delete this run" would leave a reasonable person believing the document
 * went with it. Being explicit about what SURVIVES is the point; D109 exists
 * because one word cannot honestly cover both stores.
 */
export function describeRemoval(turnCount: number): string {
  const turns = turnCount === 1 ? '1 transcript turn' : `${turnCount} transcript turns`
  return (
    `Remove this run from the Docket? It purges the run and ${turns} from the database. ` +
    `The findings document on disk is left where it is.`
  )
}

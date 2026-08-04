/**
 * 3f-0 — build the four size/cost variants of CR-3f.1.
 *
 * ⚠ THE POINT OF THIS SCRIPT IS THAT THE FOUR CASES DIFFER IN EXACTLY ONE WAY.
 * A is the base document byte-for-byte; B, C and D are A plus an appended
 * `## Exhibits` section. Same questions, same constraints, same instructions —
 * so a cost difference between runs is attributable to the pack and to nothing
 * else. (This is D98's verbatim rule applied to a measurement rather than to a
 * re-measurement.)
 *
 * ⚠ NO FEATURE IS REQUIRED. `council:start` carries brief TEXT, so the council
 * cannot tell whether these bytes arrived via a resolver or a paste. That is
 * what lets the whole cost curve be measured before exhibits are built.
 *
 * ⚠ AND THE ONE THING THIS METHOD CANNOT DO, STATED SO IT IS NOT DISCOVERED
 * LATER: a pasted pack is part of the case text, and the case text is re-sent
 * to the ARBITER in both of its turns (councilCore buildArbitrationPrompt and
 * buildSynthesisPrompt). So every run here is an "arbiter sees the pack" run.
 * The members-only arm cannot be simulated by pasting — see RESULTS.md §4.
 *
 *   node docs/Features/Foundation/Investigations/3f-0-SizeCost/build-variants.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..', '..', '..')

/** Tiers are cumulative: C is B plus its own files, D is C plus its own. Chosen
 *  so the pack is genuinely RELEVANT to the case's questions — an irrelevant
 *  pack would still cost the same tokens but would not tell us anything about
 *  whether members use what they are given. */
const TIERS = {
  B: ['src/main/services/councilCore.ts'],
  C: [
    'src/main/services/councilService.ts',
    'src/renderer/src/views/CouncilView.vue',
    'src/main/db/schema.ts'
  ],
  D: [
    'src/main/services/storage.ts',
    'src/shared/ipc.ts',
    'src/main/ipc.ts',
    'src/renderer/src/stores/council.ts',
    'src/main/services/apiSession.ts',
    'src/renderer/src/views/SettingsProviders.vue',
    'src/renderer/src/components/LaunchDialog.vue',
    'src/renderer/src/components/TerminalPane.vue'
  ]
}

const langOf = (p) => (p.endsWith('.vue') ? 'vue' : p.endsWith('.ts') ? 'ts' : '')

/** The pack format D104 specifies: numbered, path-labelled, line-numbered.
 *  Line numbers are included because they are what a finding cites — and
 *  because they are real bytes the measurement must pay for. */
function renderExhibit(n, relPath) {
  const body = readFileSync(join(REPO, relPath), 'utf8')
  const lines = body.split('\n')
  const width = String(lines.length).length
  const numbered = lines.map((l, i) => `${String(i + 1).padStart(width)}  ${l}`).join('\n')
  return (
    `### Exhibit ${n} — \`${relPath}\` (lines 1–${lines.length}, ${Buffer.byteLength(body)} bytes)\n\n` +
    '```' +
    langOf(relPath) +
    '\n' +
    numbered +
    '\n```\n\n'
  )
}

const base = readFileSync(join(HERE, 'case-base.md'), 'utf8')

/** Appended ABOVE §5 would split the questions section's scope; appended at the
 *  END is both simpler and safe, because `questionsSectionOf` stops at the next
 *  heading of equal or shallower level and §5 already closes §4. */
function build(letter, files) {
  if (files.length === 0) return base
  let out =
    base +
    '\n---\n\n## 6. Exhibits\n\n' +
    'The following files are attached in full, identically for every member. Cite them by exhibit ' +
    'number and line.\n\n'
  files.forEach((f, i) => {
    out += renderExhibit(i + 1, f)
  })
  return out
}

const cumulative = []
const rows = []
for (const letter of ['A', 'B', 'C', 'D']) {
  if (letter !== 'A') cumulative.push(...TIERS[letter])
  const text = build(letter, cumulative)
  const name = `case-${letter}.md`
  writeFileSync(join(HERE, name), text, 'utf8')
  const bytes = Buffer.byteLength(text)
  rows.push({
    variant: letter,
    files: cumulative.length,
    bytes,
    kib: (bytes / 1024).toFixed(1),
    estTokens: Math.round(bytes / 3.5)
  })
}

console.log('variant  files   bytes      KiB     ~tokens (@3.5 B/tok)')
for (const r of rows) {
  console.log(
    `   ${r.variant}     ${String(r.files).padStart(2)}   ${String(r.bytes).padStart(8)}  ${r.kib.padStart(7)}   ${String(r.estTokens).padStart(8)}`
  )
}
console.log('\n⚠ ~tokens is an ESTIMATE at 3.5 bytes/token for source. The real figure comes')
console.log('  from council_runs.tokens_in after each run — record that, not this.')

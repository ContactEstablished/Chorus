#!/usr/bin/env node
/**
 * G4 secret-grep gate (Task 3-1 / D30). Scans tracked sources and _verify/
 * artifacts for known credential shapes and exits NON-ZERO on any hit, so the
 * check is a command a reviewer runs, not an assertion an implementer makes.
 *
 * The patterns come from src/main/services/secret-patterns.json — the SAME
 * list logger.ts's scrubSecrets uses. One list, two consumers: a gate that
 * tested different shapes than the scrubber would be worse than no gate.
 *
 * Plain Node ESM, no dependencies. Usage: node scripts/secret-grep.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const { patterns } = JSON.parse(
  readFileSync(new URL('../src/main/services/secret-patterns.json', import.meta.url), 'utf8')
)
const SECRET_PATTERNS = patterns.map((p) => ({ name: p.name, re: new RegExp(p.source, 'g') }))

/** Directories to scan, relative to the repo root. _verify/ is gitignored but
 *  is precisely where a careless runtime dump would land a key. */
const SCAN_DIRS = ['src', 'scripts', '_verify']
/** Individual repo-root files worth gating (deliberately NOT package-lock.json
 *  — dependency metadata is out of scope and full of long opaque strings). */
const SCAN_FILES = ['package.json']
const SCAN_ROOT_CONFIG = /^(.*\.config\.(ts|js|mjs|cjs)|tsconfig.*\.json)$/
const SKIP_DIRS = new Set(['node_modules', 'out', '.git', '.chorus'])
const NUL = String.fromCharCode(0)

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return // absent optional dir (e.g. _verify on a fresh clone)
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full)
    } else if (e.isFile()) {
      yield full
    }
  }
}

const hits = []
function scan(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return // unreadable — nothing to gate
  }
  if (text.includes(NUL)) return // binary
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    for (const { name, re } of SECRET_PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line)) !== null) {
        hits.push({ file, line: i + 1, pattern: name, length: m[0].length })
      }
    }
  })
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(repoRoot, dir))) scan(file)
}
for (const name of SCAN_FILES) {
  const full = join(repoRoot, name)
  try {
    if (statSync(full).isFile()) scan(full)
  } catch {
    /* absent */
  }
}
for (const e of readdirSync(repoRoot, { withFileTypes: true })) {
  if (e.isFile() && SCAN_ROOT_CONFIG.test(e.name)) scan(join(repoRoot, e.name))
}

if (hits.length > 0) {
  console.error(`G4 secret-grep: ${hits.length} potential key-shaped string(s) found:`)
  for (const h of hits) {
    // The match is NEVER echoed — pattern name + match length only.
    console.error(
      `  ${relative(repoRoot, h.file)}:${h.line}  [${h.pattern}] (${h.length} chars, masked)`
    )
  }
  process.exit(1)
}
console.log(
  `G4 secret-grep: clean (${SECRET_PATTERNS.length} patterns over src/, scripts/, _verify/, package.json, root configs)`
)

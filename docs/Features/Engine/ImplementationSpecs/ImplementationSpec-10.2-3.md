# Implementation Spec 10.2-3 — the TS/JS/Vue symbol extractor

Companion to `Tasks/Task-10.2-3.md`. Every number here was measured on this repository on
2026-09-13 — `_verify/10.2-3/probe-parse.cjs` and `probe-ambiguity.cjs`, which are runnable and
should be re-run if the corpus changes.

---

## 1. Shape: pure core, impure caller

`symbolExtractorCore.ts` takes **text** and returns **rows**. It never reads a file, never spawns
git, never opens a bolt session. `memoryService.index` already owns all three and calls this the way
it calls `buildRows`.

```ts
export interface SymbolRow {
  readonly symbolId: string        // D202's grammar, below
  readonly name: string
  readonly kind: SymbolKind
  readonly relPath: string
  readonly containerName: string | null
  readonly line: number            // 1-based, in the ORIGINAL file
}
export interface DefinedInRow { readonly symbolId: string; readonly relPath: string }
export interface EdgeRow {
  readonly callerId: string
  readonly calleeId: string
  readonly resolution: 'unique' | 'ambiguous'   // D208
}
export interface ExtractResult {
  readonly symbols: readonly SymbolRow[]
  readonly definedIn: readonly DefinedInRow[]
  readonly calls: readonly EdgeRow[]
  readonly references: readonly EdgeRow[]
  /** ⚠ The honesty channel. The UI renders these; see §6. */
  readonly coverage: {
    readonly parsed: number
    readonly skippedUnsupported: number   // .py, .rs, … — named languages, not "other"
    readonly skippedUnparseable: number   // syntax errors, a '#' in relPath
    readonly ambiguousEdges: number
    readonly totalEdges: number
  }
}
```

⚠ **`SymbolKind` is a CLOSED union** — `function | method | class | interface | type | enum | const |
variable`. 10.2-3 must not widen it silently; a test pins the list, because `kind` is inside
`symbolId` and widening it re-keys every affected node.

---

## 2. `symbolId`, exactly

```
symbolId  ::=  relPath "#" qualifiedName ":" kind [ "@" ordinal ]

src/main/services/launchOptionsCore.ts#composeLaunchOptions:function
src/main/services/sessionManager.ts#SessionManager.write:method
src/main/x.ts#overloaded:function@2
```

- `relPath` — the value `normalizeRelPath()` already produces, identical to `:File.relPath`. That
  identity is what lets `LINK_DEFINED_IN` match a file without a second key.
- `qualifiedName` — dot-joined container chain, outermost first.
- `ordinal` — omitted for the first, `@2`, `@3` … in **source order**.

⚠ **Two limits, to be written into the code rather than discovered later.**

1. **The ordinal is positional**, so deleting overload #1 renumbers #2. The old node goes stale and a
   new one appears. Survivable only because `MARK_MISSING_SYMBOLS` marks rather than deletes.
2. **A `relPath` containing `#` splits ambiguously.** **Skip the file and count it** in
   `skippedUnparseable`; do not escape it. A silent mis-parse is worse than a named omission.

---

## 3. Vue, and the offset that is easy to get wrong

```ts
import { parse } from '@vue/compiler-sfc'

const { descriptor } = parse(source)
const block = descriptor.scriptSetup ?? descriptor.script
if (!block) return EMPTY                        // a template-only SFC is normal, not a failure
const code = block.content
const lineOffset = source.slice(0, block.loc.start.offset).split('\n').length - 1
// every symbol's line = (line within `code`) + lineOffset
```

⚠ **Without `lineOffset` every symbol in all 34 `.vue` files carries the wrong line**, and a unit
test that only asserts a symbol's *name* will not notice. Pin the offset with a fixture whose
`<script>` does not start at line 1.

⚠ A file may have **both** `<script>` and `<script setup>`. That is valid Vue. Extract both, or state
in the code why only one is taken.

---

## 4. Call resolution — where the honesty lives

Measured on this repo: **38,106 call sites**, resolved by name against **2,667** symbols.

| outcome | count | share | action |
|---|---|---|---|
| no matching symbol | 26,725 | 70.1% | ⚠ **emit nothing** — library/builtin |
| exactly one match | 7,088 | 18.6% | edge, `resolution: 'unique'` |
| several matches | 4,293 | 11.3% | edge to **each**, `resolution: 'ambiguous'` |

**11,381 edges written, 37.7% of them ambiguous.**

⚠ **Do not reason about this from the name-level figure.** 88.3% of distinct names are unique (2,249
names, 264 duplicated), which suggests ~12% ambiguity and is wrong by 3×. Ambiguity concentrates in
the names called most: `listener` (16 symbols), `dispose` (12), `onKeydown` (10), `snapshot` (8),
`load` (7).

```ts
const byName = new Map<string, SymbolRow[]>()   // built from THIS run's symbols
// ...
const hits = byName.get(calleeName)
if (!hits) continue                                  // 70.1% — the correct answer is silence
const resolution = hits.length === 1 ? 'unique' : 'ambiguous'
for (const h of hits) edges.push({ callerId, calleeId: h.symbolId, resolution })
```

⚠ **Resolve only within the same workspace instance.** A symbol from another project sharing a name
is not a candidate; the map is built per index run, from that run's own symbols.

---

## 5. Writing, through 10.2-2's constants

The constants exist and are uncalled; this task supplies `$rows`. **Add no new Cypher** unless a row
shape genuinely demands it — and if it does, it must go into `ALL_INDEX_STATEMENTS` or the no-DELETE
sweep will not walk it.

Order inside the existing `index` session, **after** the file writes:

```
UPSERT_SYMBOLS         rows: SymbolRow[]     (batched at INDEX_BATCH_SIZE = 200)
LINK_DEFINED_IN        rows: DefinedInRow[]  ← needs :File to exist, hence "after"
LINK_CALLS             rows: EdgeRow[]
LINK_REFERENCES        rows: EdgeRow[]
MARK_MISSING_SYMBOLS   (no rows; run stamp only)
```

⚠ **`resolution` must reach the edge.** `LINK_CALLS` as shipped sets only `lastIndexedAt`; it needs
`SET r.lastIndexedAt = $runId, r.resolution = row.resolution`. **Amending that constant is in scope
for this task** — and the amended text must still contain no `DELETE`/`DETACH`/`REMOVE`.

⚠ **Every edge needs both properties.** An edge missing `lastIndexedAt` can never be filtered out
(D203); an edge missing `resolution` silently joins the confident set (D208). Pin both.

---

## 6. The read shape, and the UI's honesty

Not shipped here — 10.2-4 ships it — but recorded so the writer matches the reader:

```cypher
// find_callers, default: confident edges only
MATCH (c:Symbol)-[r:CALLS]->(s:Symbol {workspaceInstanceId: $wid, name: $name})
WHERE r.lastIndexedAt = s.lastIndexedAt AND r.resolution = 'unique'
RETURN c.relPath AS path, c.name AS caller, c.kind AS kind
ORDER BY path LIMIT 50
```

⚠ `r.lastIndexedAt = s.lastIndexedAt`, **never** `= p.lastIndexedAt` (F127). ⚠ And a template that
drops `r.resolution = 'unique'` inherits the 37.7%.

**The UI must state what is not covered**, which the spec has required since D149 and the phase
overview repeats for Python:

> Indexed TypeScript, JavaScript and Vue. **Not** Python, Go, Rust or any other language.
> *"What calls this"* is resolved **by name**, so results for a common name may be incomplete.

⚠ Report **coverage**, not just success. "Indexed 639 files" is true and misleading when 379 of them
were never parseable.

---

## 7. Packaging (D206)

```yaml
# electron-builder.yml — files:
  - '!node_modules/typescript/lib/lib.*.d.ts'   # 99 files, 3.3 MB — type-checking only
  - '!node_modules/typescript/lib/_tsc.js'      # 5.9 MB — the tsc CLI
  - '!node_modules/typescript/lib/tsc.js'
  - '!node_modules/typescript/bin/**'
```

Measured: **22.5 MB → 13.6 MB** (102 entries), and a stripped copy still parses with
`ts.createSourceFile`. `app.asar` goes **19.8 MB → ~33 MB**.

⚠ **This was estimated at ~28 MB when D206 was taken. The real figure is ~33 MB.** Stated so the
number in the decision is not quoted later as if it had been measured.

⚠ **THE ONLY GATE THAT CLOSES THIS IS A PACKAGED RUN.** `ts.createSourceFile` needs none of the
stripped files *today*; a future TypeScript could lazily reach for one, and the failure would appear
only in the installed app. `npm run dist`, install, index, confirm a non-zero `:Symbol` count. F82 is
this repository's most repeated defect shape and this is a textbook instance of it.

---

## 8. Verification

```bash
npm run typecheck
npx vitest run
node _verify/10.2-3/probe-parse.cjs        # re-measure if the corpus moved
node _verify/10.2-3/probe-ambiguity.cjs
docker ps --filter name=chorus-memory --format '{{.Names}} {{.Status}}'
```

Runtime, **user-initiated** (D58; F129 — launching the app runs nothing):

```cypher
MATCH (s:Symbol) RETURN count(s)                                     -- ~2667, was 0
MATCH ()-[r:CALLS]->() RETURN r.resolution, count(*)                 -- both buckets
MATCH ()-[r:CALLS]->() WHERE r.lastIndexedAt IS NULL RETURN count(*) -- 0
MATCH ()-[r:CALLS]->() WHERE r.resolution IS NULL RETURN count(*)    -- 0
```

Then the packaged gate in §7.

**Non-goals to re-check before reporting done:** runtime dependencies **11**, `GRAPH_MIGRATIONS`
length **3**, `LATEST_GRAPH_VERSION` **3**, contract line count **21**, and no `DELETE`/`DETACH`/
`REMOVE` anywhere in `ALL_INDEX_STATEMENTS`.

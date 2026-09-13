# Task 10.2-3 — The TS/JS/Vue symbol extractor

**Phase:** Engine 10.2 — Code index: the symbol layer
**Status:** authored 2026-09-13, unexecuted
**Estimated:** ~3–4 days (the parser, the packaging change, and the honesty work around both)

---

## Source Of Truth

- `docs/Features/Engine/Tasks/Phase-10.2-Overview.md` — the phase contract and its six inherited gates
- `docs/Features/Engine/Tasks/Task-10.2-2.md` + `ImplementationSpecs/ImplementationSpec-10.2-2.md` — the
  schema this task fills, and the five Cypher constants it must supply rows for
- `docs/Features/Foundation/roadmap.md` — **D58** (graph work is user-initiated), **D149** and
  **D149(b)**, **D177**/**F97** (boot-time graph work refused), **D198** (the dependency, and the
  narrowing to codex), **D201** (the adoption evidence and its limits), **D202–D204**, **F82** (works
  in dev, fails packaged), **F122**, **F127**, **F129**
- Code under change: `src/main/services/codeIndexCore.ts`, a new `symbolExtractorCore.ts`,
  `src/main/services/memoryService.ts`, `package.json`, `electron-builder.yml`

---

## Initial Starting Point (verified 2026-09-13 at `b13560f`, measured not recalled)

| fact | value | how it was verified |
|---|---|---|
| graph schema | **v3 live**, `symbol-layer-identity`, checksum `2aeeefd3` | read from the running graph after a seed |
| `:Symbol` count | **0** | `MATCH (s:Symbol) RETURN count(s)` |
| the five write constants | `UPSERT_SYMBOLS`, `LINK_DEFINED_IN`, `LINK_CALLS`, `LINK_REFERENCES`, `MARK_MISSING_SYMBOLS` — exported, **called by nobody** | `codeIndexCore.ts`, `11299bf` |
| `typescript` | **5.9.3**, devDependency, **23 MB**, imported nowhere in `src/` | `package.json`, `du`, grep |
| bundler behaviour | electron-vite **externalizes** production deps — `out/main/index.js` contains `require("better-sqlite3")`, `require("neo4j-driver")`, `require("zod")` | read the built bundle |
| packaging | production `node_modules` **do** ship, inside `app.asar`; natives unpacked | `release/win-unpacked/resources/` |
| `app.asar` today | **19.8 MB** | `ls -la` |
| `@vue/compiler-sfc` | **3.5.40 installed, but TRANSITIVE** — in neither `dependencies` nor `devDependencies` | `package.json` + resolve |
| runtime dependencies | **9** | parsed from `package.json` |
| corpus | **223 `.ts` · 34 `.vue` · 3 `.js`** (639 tracked files) | `git ls-files` |

⚠ **D198(a)'s reasoning is CONFIRMED rather than inherited.** Because the bundler externalizes,
`import ts from 'typescript'` in main becomes `require("typescript")` at runtime. Without the
promotion the feature works under `npm run dev` — where `node_modules` is present — and throws in the
installed app. That is **F82's shape exactly**, and `electron.vite.config.ts` already carries a
comment warning about it for a different file.

### What the probes measured (`_verify/10.2-3/`)

**The parse is cheap.** A syntactic walk of all **260** parseable files (5.1 MB of source) took
**632 ms** and produced **2,667 symbols**: 1,152 `function`, 545 `method`, 413 `type`, 307
`interface`, 230 arrow/function consts, 20 `class`. ✅ That is comfortably inside a user-initiated
index run and needs no worker process.

**The strip is safe, and cheaper than the whole package but dearer than estimated.** A copy of
`typescript` with all 99 `lib.*.d.ts`, `_tsc.js`, `tsc.js` and `bin/` removed (**102 entries**) still
parses correctly with `ts.createSourceFile`. ⚠ **But it lands at 13.6 MB, not the ~9 MB estimated
when D206 was taken** — `22.5 MB → 13.6 MB`, so `app.asar` goes **19.8 MB → ~33 MB**, not ~28 MB.
The estimate in the decision prompt was optimistic and is corrected here.

**⚠ AND THE NUMBER THAT SHOULD GOVERN THIS TASK: 37.7% OF EVERY `CALLS` EDGE WOULD BE A GUESS.**
Resolving 38,106 call sites by name against the symbol set:

| outcome | count | share | what it means |
|---|---|---|---|
| no matching symbol | 26,725 | 70.1% | library/builtin call — **emit no edge** |
| exactly one match | 7,088 | 18.6% | a confident edge |
| **several matches** | **4,293** | **11.3%** | **an edge that would lie** |

Of the **11,381** edges actually written, **37.7% are ambiguous**. ⚠ **And the distribution is a
trap:** 88.3% of distinct *names* are unique (2,249 names, only 264 duplicated), so a name-weighted
reading says "12% ambiguous" and is wrong by 3×. Ambiguity concentrates in exactly the names that get
called most — `listener` (16 symbols), `dispose` (12), `onKeydown` (10), `snapshot` (8), `load` (7).

---

## Goal

Fill the v3 schema: walk every tracked `.ts` / `.js` / `.vue` file syntactically, write `:Symbol`
nodes and `DEFINED_IN` / `CALLS` / `REFERENCES` edges through the constants 10.2-2 already shipped,
and make the resulting index **honest about what it does not know** — in the graph, in the read
template, and in the UI.

---

## Decisions

**D205 (SETTLED 2026-09-13, Matthew): the parse is SYNTACTIC, per file.** `ts.createSourceFile`,
no type checker, no `Program`, no `tsconfig` resolution. Symbols and `DEFINED_IN` are exact; `CALLS`
is name-matched. This confirms D149's judgement that a type-checked program is a phase, not a task.

**D206 (SETTLED 2026-09-13, Matthew): promote `typescript`, stripped at package time.** Exclude
`lib.*.d.ts`, `_tsc.js`, `tsc.js` and `bin/**` via `electron-builder.yml`. ⚠ **This is only valid
because the parse is syntactic** — a type-checked program loads the lib set. ⚠ **And it carries an
F82-shaped risk that a packaged runtime gate is the only way to close:** stripping a file the parser
lazily reaches for fails *only* in the installed app.

**D207 (SETTLED 2026-09-13, Matthew): declare `@vue/compiler-sfc` as a runtime dependency** and use
`parse()` for `.vue`. Runtime dependencies go **9 → 11**. ⚠ Relying on it transitively is already a
latent bug: a `@vitejs/plugin-vue` bump could remove it with no error until a `.vue` file is indexed.

**D208 (settled 2026-09-13 by this kickoff, flowing from D205 — raise it if you disagree): an edge
records how confidently it was resolved, and the reader defaults to confident edges only.** Every
`CALLS`/`REFERENCES` edge carries `resolution: 'unique' | 'ambiguous'`. `find_callers` filters
`r.resolution = 'unique'` by default.

- **Why not drop ambiguous edges entirely:** `find_callers('dispose')` would return silence, which
  reads as "nothing calls this" — a confident wrong answer, the worst output this feature can give.
- **Why not emit them unlabelled:** 37.7% of results would be guesses presented as facts, which is
  D203's "worse than `rg`" failure arriving through a different door.
- **What this costs:** one property per edge, and a read template that must carry the filter. ⚠ A
  template that forgets it inherits the 37.7%.

---

## Exact Scope

**Create:**
- `src/main/services/symbolExtractorCore.ts` — **pure**: text in, rows out. No `fs`, no `git`, no
  driver, no electron. Mirrors `codeIndexCore.ts`'s posture.
- `src/main/services/symbolExtractorCore.test.ts`

**Edit:**
- `src/main/services/memoryService.ts` — call the extractor inside the existing `index` flow and
  write its rows through the five constants; extend the index report.
- `src/main/services/codeIndexCore.ts` — only if a row type genuinely belongs beside the others.
- `package.json` — `typescript` and `@vue/compiler-sfc` into `dependencies` (**9 → 11**).
- `electron-builder.yml` — the strip patterns.
- `src/renderer/…` — the index result must state what was **not** covered (see Non-Goals).

**Touch nothing else.**

---

## Non-Goals

- ❌ **No type checker, no `ts.createProgram`, no `tsconfig` resolution** (D205).
- ❌ **No Python, and the UI must say so** — the spec's own honesty requirement. The index report
  states the languages covered and the count skipped, rather than showing a Python project an empty
  index.
- ❌ **No contract lines and no `find_callers` template in this task.** That is 10.2-4. ⚠ The read
  shape is recorded in the spec so the writer matches the reader, but shipping the template before
  the extractor runs would answer zero rows — F122's failure.
- ❌ **No boot-time indexing.** D58 keeps graph work user-initiated; D177/F97 refused boot-time graph
  work explicitly. ⚠ F129 records an implementer nearly "fixing" a quiet boot that way.
- ❌ **No `DELETE`, `DETACH` or `REMOVE`** — D149(b). A symbol that leaves the tree is marked via
  `MARK_MISSING_SYMBOLS`.
- ❌ **No graph migration.** v3 is already live; `GRAPH_MIGRATIONS` stays at length 3 and
  `LATEST_GRAPH_VERSION` stays 3.
- ❌ **No source text, no signatures, no embeddings** on `:Symbol` (D149's posture).
- ❌ **No claude delivery** (D198 — codex only).
- ❌ **Do not revert, stage or commit the pre-existing dirty files:** `package.json` and
  `package-lock.json` are **already staged** with an unrelated version bump — ⚠ **this task edits
  `package.json` too, so add your change and commit by pathspec without disturbing what is staged**;
  also `TerminalPane.vue`, `.claude/`, `.procoder/`.

---

## Dependencies

- **10.2-2** — ✅ landed (`11299bf`). The schema and all five constants exist.
- ⚠ **The `chorus-memory` container has `RestartPolicy=no`** (F122). Prove it is up before any step
  that reads the graph, and say so in the report.

---

## Step-by-step Work

1. **Write `symbolExtractorCore.ts` pure**, with `symbolId` built exactly to D202's grammar:
   `<relPath>#<qualifiedName>:<kind>[@<ordinal>]`.
2. **Handle `.vue` through `@vue/compiler-sfc`**, and ⚠ **correct the line offset** — `block.loc.start.offset`
   maps script-block lines back to the `.vue` file, or every symbol's `line` is wrong.
3. **Resolve calls by name** against the symbols found in the same workspace instance; set
   `resolution` per D208; **emit no edge at all** for the 70.1% that match nothing.
4. **Wire into `memoryService.index`**, after the file/commit writes so `LINK_DEFINED_IN` can match
   `:File` rows that already exist in the same run.
5. **Promote both dependencies and add the strip patterns.**
6. **Report coverage honestly** in the index result: languages covered, files skipped, symbols
   written, and the ambiguous-edge share.

---

## Test Expectations

- `symbolId` grammar: nesting, overload ordinals in source order, and a `relPath` containing `#`
  is **skipped and counted**, never silently mis-parsed (spec §2's limit).
- `.vue`: `<script setup>`, plain `<script>`, `lang="ts"`, and a file with **both** blocks; line
  numbers are the `.vue` file's, not the block's.
- Call resolution: a uniquely-named callee yields `resolution: 'unique'`; a name borne by several
  symbols yields `ambiguous` **for every edge emitted**; an unmatched name yields **no edge**.
- ⚠ **A test pinning that no edge is written without `resolution`** — an unlabelled edge silently
  joins the confident set.
- The extractor is pure: no `fs`/`git`/driver import. Assert on the import list, not on prose (F120).

---

## Verification Commands

```bash
npm run typecheck
npx vitest run
node _verify/10.2-3/probe-parse.cjs         # 260/260 files, ~632 ms, 2667 symbols
node _verify/10.2-3/probe-ambiguity.cjs     # 37.7% of written edges ambiguous
docker ps --filter name=chorus-memory --format '{{.Names}} {{.Status}}'
```

Runtime gate — ⚠ **user-initiated, per D58 and F129; launching the app applies nothing**:

```js
await window.chorus.indexMemory('<projectId>')   // or Project settings → Memory → Index
```

```cypher
MATCH (s:Symbol) RETURN count(s)                                    // expect ~2667, was 0
MATCH (s:Symbol)-[:DEFINED_IN]->(f:File) RETURN count(*)
MATCH ()-[r:CALLS]->() RETURN r.resolution, count(*)                // both buckets present
MATCH ()-[r:CALLS]->() WHERE r.lastIndexedAt IS NULL RETURN count(*) // MUST be 0 (D203)
```

⚠ **PACKAGED GATE — D206 cannot be closed any other way.** Build the installer, install it, and make
the **installed** app index a project. A stripped file the parser lazily needs fails only here.

```bash
npm run dist
# then: install, open a project, run Memory → Index, and confirm a non-zero :Symbol count
```

---

## Acceptance Criteria

- [ ] `count(:Symbol)` non-zero after a user-initiated index; `DEFINED_IN` present for every symbol
- [ ] **No `CALLS`/`REFERENCES` edge lacks `lastIndexedAt`** (D203) **or `resolution`** (D208)
- [ ] `find_callers`-shaped read with `resolution = 'unique'` returns only confident callers
- [ ] Runtime dependencies **11**; `GRAPH_MIGRATIONS` length still **3**; contract line count still **21**
- [ ] ⚠ **The PACKAGED app indexes successfully** — the strip did not remove something needed
- [ ] The index report states languages covered, files skipped, and the ambiguous share
- [ ] The pre-existing staged `package.json` change is undisturbed

---

## Review Checklist

1. Is `symbolExtractorCore.ts` genuinely pure — asserted on imports, not claimed in a comment?
2. Are `.vue` line numbers the file's, or the script block's? (Off-by-`offset` is invisible in unit
   tests that only check a name.)
3. Does any edge escape without `resolution`, and does the read template actually filter on it?
4. ⚠ Was the **packaged** app tested, or only `npm run dev`? D206's whole risk lives there, and F82
   is this repo's most repeated defect shape.
5. Does the index report tell the truth about coverage, or only about success?
6. ⚠ Does any new grep gate match the prose documenting its own rule? Six have landed (F120, F123,
   F128) — the most recent was written *by* the author of the finding it was enforcing.

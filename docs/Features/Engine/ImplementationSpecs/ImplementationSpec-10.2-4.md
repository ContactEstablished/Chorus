# Implementation Spec 10.2-4 — the `find_callers` template and its battery

Companion to `Tasks/Task-10.2-4.md`. Two lines of prose and a measurement design; the measurement is
the larger half.

---

## 1. The two lines, verbatim

Append to `memoryContractLines` in `instructionsCore.ts`, **after** the `FIND A FILE` pair so the
structural templates sit together.

⚠ **EACH IS ONE PHYSICAL LINE.** `assertSingleLine` (`instructionsCore.ts:216`) throws on `\r` or
`\n`, and D148's note explains why: codex takes the contract as a single
`-c developer_instructions=` token, and a broken one is *"a contract that simply never arrives,
indistinguishable from an agent that read it and ignored it."* Wrapped below for reading only.

```ts
`WHAT CALLS A FUNCTION: when you need every caller of a function or method — before running rg
 or a text search for its name — run the FIND CALLERS template instead; it answers from an index
 of this repository's symbols in one round trip.`,

`FIND CALLERS: MATCH (c:Symbol)-[r:CALLS]->(s:Symbol {workspaceInstanceId: $wid, name: $name})
 WHERE r.lastIndexedAt = s.lastIndexedAt RETURN c.relPath AS path, c.name AS caller,
 r.resolution AS confidence ORDER BY confidence DESC, path LIMIT 50`,
```

### Why each clause is the way it is

- **`WHAT CALLS A FUNCTION:`** — leads with the **trigger situation**, not the subject noun. This is
  the shape measured working in the 2026-08-30 description A/B and again in the 10.2-1 spike.
- **`before running rg or a text search for its name`** — names the command being replaced. The
  spike's line did the same.
- **`run … instead`** and no *"you must"*. ⚠ D200(e): commanding buys a call that measures
  obedience, and the number would not transfer.
- **`$wid` / `$name` as parameters** — never interpolated. Line 15 of the contract already requires
  this, and a template that broke it would teach the opposite.
- **`r.lastIndexedAt = s.lastIndexedAt`** — the callee's own stamp. ⚠ **Never `p.lastIndexedAt`**
  (**F127**): measured to return 1 of 2 live callers once a project holds two workspace instances,
  and unable to fail today, which is why it would survive review.
- **`r.resolution AS confidence` and NO filter on it** — **D210**, which supersedes D208's read-shape
  half. The agent sees both buckets.
- ⚠ **`ORDER BY confidence DESC`** — and the `DESC` is not cosmetic. `'ambiguous' < 'unique'`
  alphabetically, so plain ascending order would put **the guesses first**. An earlier draft of this
  template had exactly that bug.

---

## 2. The test changes

`instructionsCore.test.ts:56` pins the count. Move it **deliberately**, with a comment, as the
19 → 21 change did:

```ts
// ⚠ 21 → 23: Task 10.2-4 adds a FIND CALLERS template and the trigger line
// that introduces it. Both come back OUT if the symbol tier is dropped.
expect(lines).toHaveLength(23)
```

New cases:

```ts
const trigger = lines.find((l) => l.startsWith('WHAT CALLS A FUNCTION:'))
const template = lines.find((l) => l.startsWith('FIND CALLERS:'))

expect(trigger).toMatch(/^WHAT CALLS A FUNCTION: when you need/)   // situation, not noun
expect(trigger).not.toMatch(/you must|always use|do not use rg/i)  // no command (D200(e))
expect(template).toContain('$wid')                                  // parameterised
expect(template).toContain('$name')
expect(template).toContain('r.lastIndexedAt = s.lastIndexedAt')     // F127
expect(template).not.toMatch(/p\.lastIndexedAt/)                    // F127, the wrong form
expect(template).toContain('r.resolution AS confidence')            // D210
expect(template).not.toMatch(/resolution\s*=\s*'unique'/)           // D210 supersedes D208(c)
expect(template).toContain('ORDER BY confidence DESC')              // guesses must not lead
for (const l of [trigger, template]) expect(l).not.toMatch(/[\r\n]/) // assertSingleLine
```

---

## 3. The battery (D211)

### What it must avoid

D200 and D201 were **n = 1, no control arm**, and F125 later showed the instrument had been wrong
for two passes. The battery exists to not repeat either.

### Design

**Six questions**, each one a symbol index should plausibly win, each answerable from this repo, none
naming the graph, Cypher, the index or memory:

1. Which files call `composeLaunchOptions`?
2. What calls `normalizeRelPath`, and from where?
3. If `sessionManager.ts` changed, which files hold code that calls into it?
4. Where is `pendingMigrations` used?
5. Which callers does `migrationChecksum` have?
6. What calls `workspaceInstanceIdFor`?

⚠ **Include at least one question whose answer name is AMBIGUOUS** (F130's `dispose`/`load` class),
so the battery exercises D210's labelling rather than only its happy path.

### The two arms

| arm | contract | index |
|---|---|---|
| **control** | 21 lines, at the commit **before** this task | ✅ populated |
| **treatment** | 23 lines, at the commit **after** | ✅ populated |

⚠ **BOTH ARMS MUST RUN AGAINST A POPULATED INDEX.** If the control runs on an empty `:Symbol` set,
it differs from the treatment by *two* variables — no template **and** no data — and the comparison
measures nothing. Confirm `MATCH (s:Symbol) RETURN count(s)` non-zero **per arm**.

⚠ **Run both arms the same day.** The only clean way to remove the template is to check out the
commit before it; that makes the arms temporally separated, and codex updates itself. Same-day
removes most of that, and the codex version must be recorded for both arms.

### What is measured, per session

Read from the rollout, on **inner `tools.*()` invocations** (F125 — outer `exec` calls are JavaScript
programs and hide everything):

1. **Was the contract delivered?** Check the process argv for `FIND CALLERS` **before reading the
   result**. ⚠ A session without it is **VOID, not negative**.
2. **Did it query the graph at all?**
3. **Did it query INSTEAD of searching** — the substitution question D201 could not answer, because
   its question was compound.
4. **Was the answer correct?** Scored against the real callers, found independently.

⚠ **The repo filter must match Chorus's own worktrees** — `ContactEstablished\.chorus\Chorus\wt-…`
does not contain `ContactEstablished\Chorus` (**F126**).

### How to read the outcome, decided in advance

Stated before the run so the result is not rationalised afterwards:

| outcome | meaning |
|---|---|
| treatment queries the graph in **most** sessions and searches less | ✅ the tier's premise holds; `find_references` / `impact_of` are worth adding |
| treatment queries the graph but **also** searches, as in D201 | ⚠ adoption without substitution — the templates are used but save nothing; **the tier does not pay for itself** |
| treatment behaves like control | ❌ two lines and ~7 days of extractor work bought nothing; record it and close the tier |
| either arm runs with an empty index or an undelivered contract | ⚠ **VOID** — re-run; do not report it as a negative |

⚠ **n = 6 per arm is still small.** It can support "did anything change at all"; it cannot support a
rate. Say so in the result rather than letting a percentage imply precision it does not have.

---

## 4. Verification

```bash
npm run typecheck
npx vitest run
npx vitest run src/main/adapters/instructionsCore.test.ts
docker ps --filter name=chorus-memory --format '{{.Names}} {{.Status}}'
```

```cypher
MATCH (s:Symbol) RETURN count(s)                     -- non-zero, per arm
MATCH ()-[r:CALLS]->() RETURN r.resolution, count(*) -- both buckets exist to be labelled
```

**Non-goals to re-check before reporting done:** contract line count **23**, `GRAPH_MIGRATIONS`
length **3**, runtime dependencies unchanged by this task, and no `find_references` / `impact_of`
template present.

⚠ **And the honest close:** whatever the battery says, it is one repository, one model and six
questions. The result belongs in the roadmap with those limits attached — the way D201 was recorded,
and for the same reason.

---
name: project-memory
description: Use at the START of any investigation in this repo, BEFORE running Grep, Glob or Read — "how does X work", "why does Y happen", "understand the mechanism", "where do I start", debugging something, or about to edit an unfamiliar file. Earlier sessions' root causes, measured numbers, traps and decisions are stored in this project's memory graph and are NOT in the code, so searching the files first re-does work that is already done. Also use AFTER verifying something durable — a root cause found, a number measured, a decision taken, a belief disproved — to record it, and when a graph write returns an empty object, when a stored memory has become wrong, or when asked to "check the graph", "what do we know about X", or "remember this".
user-invocable: true
---

# Project memory

This repository has a Neo4j graph reachable through the `chorus-memory` MCP server. It holds
what earlier sessions **verified** — root causes, measured numbers, traps, decisions and their
reasons — with a `SUPPORTED_BY` edge to the file or commit that backs each one.

**Why this skill exists.** A 2026-08-29 audit measured the gap and it is one-sided. Writing is
happening: 10 of 18 claude sessions since the graph was provisioned wrote at least one memory,
during ordinary feature work. **Reading is the weak half** — session after session went straight
to `Grep` on a topic the graph already had an answer for (`memory_shell_first = 1`, over and
over). The single highest-value habit in this file is §1.

## The five moments

| When | Do this |
|---|---|
| About to explore a topic | §1 — topic search, before the first `Grep`/`Glob`/`Read` |
| About to change a file you don't own | §2 — file-scoped read |
| Picking up cold, or resuming | §3 — recent-first |
| You verified something durable | §4 — write it, cited |
| Something in the graph is now wrong | §5 — supersede it, never delete |

---

## 1. Read before you explore

Run this **first**, with `$q` set to the topic, before opening the code:

```cypher
CALL db.index.fulltext.queryNodes('memory_text', $q) YIELD node AS m, score
WHERE m.chorusProjectId = $projectId AND m.validTo IS NULL
RETURN m.id AS id, m.content AS content
ORDER BY score DESC LIMIT 10
```

`$projectId` is in the memory contract at the top of your system prompt. If there is no contract
block, read it once: `MATCH (p:Project) RETURN p.id` — there is exactly one.

**Query craft — this is a Lucene index over `Memory.content`, and using it as one raises recall
a lot.** All three of these are verified against this graph:

- `"reasoning effort"` — a quoted phrase, when the words only mean something together.
- `codex OR opencode OR adapter` — bare terms are already OR'd; naming the synonyms yourself
  is what finds a note that used the other word.
- `overlay~ OR dictaton~` — a trailing `~` is fuzzy, and forgives both your typo and theirs.

**Run two searches, not one:** the narrow phrase you have in mind, then a broad OR of the
synonyms a previous session might have used. A single well-spelled query is how the graph
looks empty when it is not.

**What to do with the result.** Every memory is a **prior finding to verify, not a fact.** They
are written by other sessions, some months old. If one names a file, a function or a flag,
confirm it still exists before acting on it — but confirming a named claim is far cheaper than
the search you were about to run, which is the whole point.

## 2. Read what is known about the file you are about to change

Nothing else in the toolchain can answer this, and the contract never mentions it:

```cypher
MATCH (m:Memory)-[:SUPPORTED_BY]->(f:File {workspaceInstanceId: $wid, relPath: $relPath})
WHERE m.validTo IS NULL
RETURN m.content AS content, m.validFrom AS at
ORDER BY at DESC
```

`$wid` is in your contract block and is always `pj:<projectId>`, **never** `wt:<worktreeId>`,
even in a worktree session. `$relPath` is repository-relative with forward slashes.

Do this before a non-trivial edit to a file you have not already read this session. Files in
this repo carry load-bearing comments *and* off-file findings; this is where the second kind
lives.

## 3. Picking up cold

Fulltext cannot answer "what happened lately". This can:

```cypher
MATCH (m:Memory) WHERE m.chorusProjectId = $projectId AND m.validTo IS NULL
RETURN m.validFrom AS at, m.content AS content
ORDER BY at DESC LIMIT 5
```

## 4. Write after a milestone

**Use the WRITE templates in your system prompt's contract block verbatim.** They are generated
from `src/main/adapters/instructionsCore.ts` and carry this session's real ids. They are
deliberately *not* copied into this file: a second copy would drift from the generator, and the
drift would be invisible — the write would succeed and simply not be counted.

**Write when you have:**

- found a root cause, especially one that took real work to find;
- measured something (a timing, a threshold, a count) that a future session would otherwise
  re-measure;
- hit a trap that looks like something else — the silent failures, the false greens;
- taken a decision, with the reason it beat the alternative;
- proven a plausible belief **wrong**. These are among the most valuable and the least written.

**Do not write:** running commentary, a summary of what you just did, anything you have not
verified, or anything the repo already records — code structure, git history, `CLAUDE.md`, the
roadmap. If it is already in a file, cite the file instead.

**Shape the content so it is still useful in two months.** Lead with the finding, not the
narrative. Name the file and the symbol. Give the number you measured and how you measured it.
State the bound you did *not* prove, explicitly — a memory that hides its limits gets trusted
past them. Length is fine; vagueness is not.

**Every memory must cite a source.** The `SUPPORTED_BY` edge to an existing `:File` or `:Commit`
is what makes it count; a `PRODUCED` edge alone leaves it unsourced.

## 5. Supersede, never delete

A memory that has become wrong is superseded with the SUPERSEDE template in your contract, which
writes the new belief, links `SUPERSEDES`, and sets `validTo` on the old one. **Never delete or
relabel a memory you did not write.** The old belief being visible, with the date it stopped
being true, is the point.

---

## Failures we have actually hit

**A write came back as `{}`.** That is not an error — it is a `MATCH` that found nothing, and
the server reports it as success. Nothing was written. Almost always the `relPath` is wrong.
Find the real one instead of guessing:

```cypher
MATCH (f:File {workspaceInstanceId: $wid}) WHERE f.relPath ENDS WITH $suffix
RETURN f.relPath AS relPath ORDER BY relPath LIMIT 10
```

**Never repair that by switching to `CREATE`** for the `:File`. Chorus generates those nodes
wholesale; a hand-created one is a second node under a name Chorus does not index, and it is
worse than the failed write.

**A write summary is not the `RETURN` rows.** A success reads like
`{nodes_created: 1, relationships_created: 2, properties_set: 7}`. The named fields in the
`RETURN` clause never arrive — the tool discards result rows. Read the summary; a malformed
query is a tool *error*, a `MATCH` that found nothing is a *success*, and only the summary
tells those two apart.

**Pass every value as a parameter**, never interpolated into the query string. One apostrophe in
your prose is a syntax error, and prose about a query is an injection.

**A `:Memory` carries exactly the properties the contract names, and no others.** Chorus reads
only that list, so an invented property is invisible to it and to every later session. How sure
you are is not a property — say it in the content, or cite a second source.

## If your system prompt has no contract block

You were launched outside Chorus, or the graph did not answer at launch. **Reads still work** —
§1 to §3 need only `$projectId`, which §1 shows how to read. **Writes cannot**: they `MATCH` an
`:AgentSession` node that only a Chorus launch creates, so every write returns `{}`. Say so
plainly rather than retrying, and put the finding somewhere durable instead.

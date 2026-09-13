# Engine — Phase 10.2 Overview: the symbol layer, gated on adoption

**Created** 2026-09-13 by the phase kickoff. **Nothing built.**
**Gated by D199** (10.1's ledger had to take a reading first — it now has).
**Narrowed by D198** to OpenAI agents: **codex only**.

Spec: [`../chorus-engine-spec.md`](../chorus-engine-spec.md) §5 Phase 10.2.
Roadmap: [`../../Foundation/roadmap.md`](../../Foundation/roadmap.md) Phase 10.

---

## 1. The phase contract

The spec sells this tier as an index that answers *callers / references / impact* instead of the
agent reading the repository a file at a time, citing Halv's **−59% tokens per correct answer** on
SymPy.

**⚠ THE RISK THAT DECIDES THIS PHASE IS NOT PARSING. IT IS ADOPTION.** A perfect symbol index that
codex never queries is 6–8 days spent for nothing, and this repo already has the measurement that
makes that the live question. So **Task 10.2-1 is a spike, and it is a gate**: prove codex will
reach for a graph query in the trigger situation, *before* anything is indexed.

---

## 2. Verified ground facts (measured 2026-09-13 at `3cae586`, not recalled)

### 2.1 The target behaviour is large, and it is codex's

Measured across **482 codex rollout records** under `~/.codex/sessions`, **39,604 tool calls**:

| | |
|---|---|
| search-like shell calls | **8,270 — 20.9% of all codex tool calls** |
| of which | `rg` 7,301 · `Select-String` 878 · `grep` 73 · `findstr` 18 |
| chorus-memory tool calls by codex | **0, ever** |

For contrast, claude (497 transcripts, 46,828 tool calls) greps in **3.2%** of calls and has used
the memory server **147** times — 0.314%, and **nothing since 2026-09-04**.

✅ **So D198's narrowing pointed at the better target: codex searches 6.5× more often than claude.**

### 2.2 ⚠ BUT THE ZERO IS ABSENCE, NOT REFUSAL — AND THAT IS THE WHOLE DESIGN OF 10.2-1

Before concluding codex ignores the contract, it was checked whether codex was ever *given* one:

| marker in a codex rollout | rollouts |
|---|---|
| `chorus-memory` (the **server config**) | **146** (127 in this repo) |
| `This project has a memory graph` (the **contract**) | **3** |
| `read_neo4j_cypher` | **5** |
| **`READ BEFORE EXPLORING`** (the trigger-situation line) | **0** |

**Codex receives the SERVER in 146 sessions and the INSTRUCTIONS in 3.** The line that leads with
the trigger situation — the exact technique the spec proposes reusing — **has never once reached
codex**. (It was added 2026-08-21 in `1c14603`, so its absence is partly age; the contract as a
whole reaching only 3 of 146 is not.)

⚠ **This is why the spike may succeed where the raw number suggests it cannot: the intervention has
never been applied.** It also means step one is to make the contract arrive at all — which may be
the entire fix.

### 2.3 ⚠ THE SPEC IS WRONG ABOUT THE DELIVERY MECHANISM — THERE ARE NO "NEW MCP TOOLS" TO ADD

§5 says *"New MCP tools on the existing `chorus-memory` server: `find_callers`, `find_references`,
`impact_of`"*. **That is not possible as written.** `chorus-memory` is **third-party** —
`uvx mcp-neo4j-cypher` **0.6.0** from PyPI (`memoryService.ts:357-361`) — and Chorus does not own
its tool list. Chorus writes MCP *config*, never tools (`mcpConfigCore.ts`, `mcpConfigWrite.ts`).

✅ **What Chorus actually ships is CONTRACT PROSE carrying named Cypher templates**, run through the
server's generic `read_neo4j_cypher`. `instructionsCore.ts:117` (`memoryContractLines`) is the whole
mechanism: `READ:`, `WRITE (cited to a file):`, `SUPERSEDE (never delete):` are templates, not tools.

**So Phase 10.2's three "tools" are three more templates** — which is *cheaper* than the spec
implies and removes any need for a Chorus-owned MCP server. It also means **the spike costs almost
nothing to build**: one template and one contract line.

### 2.4 The graph, read live

Neo4j was down for five days (container `chorus-memory`, `neo4j:5-community`, exited 255 at
**2026-09-08T14:58**, `RestartPolicy=no`). Restarted 2026-09-13 and read:

| label | n |
|---|---|
| `File` | **607** |
| `Commit` | **250** |
| `Directory` | **43** |
| `AgentSession` | 29 |
| `Memory` | **21** (the spec's 2026-09-03 figure was 18) |

✅ Relationship types present: `CONTAINS`, `MODIFIED`, `PRODUCED`, `SUPPORTED_BY` — **none of
`CALLS` / `REFERENCES` / `DEFINED_IN`**, so the symbol layer is greenfield.
✅ `ChorusMigration` versions are **1.0 and 2.0** in the store, matching `GRAPH_MIGRATIONS` in
source — so **graph `v3` is next free in BOTH halves**, not just in the array.
⚠ A `Class` label exists, declared by graph v2 and **unpopulated**, exactly as the spec says.

⚠ **The container was down for five days and nobody noticed**, which is itself evidence about the
delivery vehicle this phase depends on.

### 2.5 The dependency, approved and not yet taken

✅ `typescript ^5.9.3` is a **devDependency**, **23 MB**, and **imported nowhere in `src/`**.
Runtime deps: **9**. **D198 approves the promotion to `dependencies` (9 → 10)** — but it belongs to
the task that first parses something, **not to the spike**, which parses nothing.

---

## 3. Decisions this phase inherits

- **D198 (2026-09-13)** — the tier is **codex-only**; `typescript` may be promoted. ⚠ "An OpenAI
  agent" is read as **the `codex` adapter**; if something wider was meant, D198 is where to say so.
- **D199 (2026-09-13)** — measurement first. Satisfied: 10.1-5 produced a reading that matched an
  independent calculation exactly.
- **D196** — content never leaves the module; only counters do. The symbol layer stores **symbol
  names and locations**, which is content of a different kind, and ⚠ **the phase must decide
  explicitly what a `:Symbol` node may hold** — that is a task-level decision, flagged here so it is
  not made by accident.

---

## 4. Task split

⚠ **10.2-1 AND 10.2-2 ARE AUTHORITATIVE; 10.2-3 AND 10.2-4 REMAIN PROVISIONAL** and must not be
built toward until each gets its own kickoff.

| # | Task | Status |
|---|---|---|
| **10.2-1** | **Adoption spike — will codex query instead of grepping?** | ✅ **RAN TWICE — gate PASSED (D200 as amended, and D201)** |
| **10.2-2** | Graph migration `v3`: `:Symbol` nodes and `CALLS`/`REFERENCES`/`DEFINED_IN` | ✅ **authored 2026-09-13, unexecuted** — `Task-10.2-2.md` + `ImplementationSpec-10.2-2.md`; D202–D204 resolved |
| 10.2-3 | The TS/JS/Vue symbol extractor (`typescript` promoted here, D198) | ⚠ provisional |
| 10.2-4 | The three contract templates and their adoption measurement | ⚠ provisional |

**If the spike fails, the remaining tasks are not written.** The finding is recorded, ~7 days are
saved, and the tier is closed — the same shape as 10.4's half-day proxy probe, which exists to kill
a 17-day build for half a day's work.

---

## 5. Phase-wide non-goals

- **No index, no parser, no `typescript` promotion in the spike.** It parses nothing.
- **No Chorus-owned MCP server** (see §2.3 — it is not needed).
- **No claude delivery** (D198). ✅ A side benefit: claude's MCP mechanism writes `.mcp.json` **into
  the user's repository**, and not delivering to claude avoids that write for this feature entirely.
- **No Python, and the UI must say so** rather than showing a Python project an empty index.
- **No change to the existing memory contract's meaning** — the spike ADDS one template and does not
  rewrite the memory templates agents may already be relying on.
- Do not revert or commit the pre-existing dirty files: `package.json`, `package-lock.json` (both
  **staged**), `TerminalPane.vue`, `.claude/`, `.procoder/`.

---

## 6. Gates every task inherits

1. ✅ **The adoption gate (10.2-1) — PASSED 2026-09-13, on the second observation (D201).** Asked a
   question the graph could answer completely, codex queried the index and ran **no** repo search or
   listing; the one shell call verified the paths the graph returned. ⚠ **But read D201(e)–(f)
   before treating the tier as justified:** there is no control arm, the question was favourable by
   construction, and the corpus figure the tier must move is **11.3%** of inner invocations — most
   of them *content* searches a file-path index cannot serve. **The ceiling is still unmeasured.**
2. ⚠ **Graph `v3` is claimed the way SQLite versions are**: parse `GRAPH_MIGRATIONS` *and* read
   `ChorusMigration` from the store before writing it. Both halves read 2 today.
3. ⚠ **Measure codex from its own rollouts** (`~/.codex/sessions`), never from claude's transcripts.
   They are different corpora with different shapes, and this phase serves codex alone.
4. ⚠ **Validate an instrument on a known positive before believing a negative** (F121). This
   kickoff's central finding came from doing exactly that.
5. ⚠ **Strip comments before grepping, or assert on structure** (F120 — four self-matching gates in
   Phase 10.1).
6. ⚠ **The `chorus-memory` container has no restart policy** and was down five days unnoticed. Any
   task depending on the graph must check it is up rather than assume, and say so in its report.

---

## 7. Phase acceptance

**For the spike (10.2-1) — the only part currently in scope:** codex, in a trigger situation, runs
the graph template instead of shelling out, observed in its own rollout record; or it does not, and
the phase closes with a recorded finding.

**For the tier, if it proceeds:** `MATCH (s:Symbol) RETURN count(s)` non-zero, `find_callers` on a
known Chorus function returning what the editor's own find-references returns, and — the part the
spec asks for and 10.1 now makes possible — **a measured change in `CE` per completed task**, not an
assertion that the index helps.

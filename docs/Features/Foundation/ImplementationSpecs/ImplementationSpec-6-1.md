# ImplementationSpec 6-1 — The Council Gate and the D4 Pass

**Normative for:** [`../Tasks/Task-6-1.md`](../Tasks/Task-6-1.md). **Its design input is
[`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) §10 and §12**, which this spec operationalises
rather than restates.

## 1. The D4 re-probe, and why the labels matter more than the answers

Plan §10 splits its findings three ways and **that split is the deliverable**, not a formatting
choice. Reproduce it in `6-1-D4-Pass.md` with these exact headings:

```markdown
## Live-probed (strong)
## Binary-inspected only (weaker — confirmed / refuted live)
## Established this session (was: not verified at all)
## Still unverified, and what that blocks
```

For each fact record **the command run, the date, and the raw answer.** Not a summary.

**Already re-probed at kickoff, 2026-07-28, method `<tool> --version`:** codex 0.145.0 · claude
2.1.218 · opencode 1.18.8 · kimi 0.29.1 · docker 28.0.4 · uvx/uv 0.11.19 · npx 11.12.1, all on PATH.
**Re-probe anyway if any time has passed** — that is the point of the rule.

**The linchpin, and it must be re-run first:**

```bash
codex mcp list --json -c 'mcp_servers.chorus_probe.command="uvx"' -c 'mcp_servers.chorus_probe.args=["--help"]'
```

**If codex no longer accepts per-invocation `-c mcp_servers.…`, Stage 1 is no longer a zero-write
commit and the whole staging must be re-thought rather than pushed through.** Say so loudly; do not
work around it. Confirm also that **it writes nothing** — diff `~/.codex/config.toml` before and
after by hash.

**Confirm the two binary-inspected claims live**, because Stage 4 depends on both:

- claude `${VAR}` expansion: write a `.mcp.json` in a **scratch** dir, then
  `claude mcp get <name>` and read back whether the var expanded and whether an unset one is
  reported as `missingVars` and left literal.
- opencode `{env:VAR}` substitution and `OPENCODE_CONFIG` naming a **file path** (not a directory).

## 2. The six unverified items — and the two that can change the design

Plan §10's "not verified at all" list, with what each one gates:

| # | Item | Gates |
|---|---|---|
| 1 | `neo4j:5-community` — tag exists? which major? **is APOC needed for v1 at all** (drop it unless a seed statement requires it) | Stage 5, and the seed list in 6-4 |
| 2 | **The Neo4j MCP server: real package name, registry (`uvx`/PyPI vs `npx`/npm), exact env var names (`NEO4J_URI` vs `NEO4J_URL`, `NEO4J_USERNAME` vs `NEO4J_USER`, `NEO4J_DATABASE`) — and CRITICALLY, does it connect at all with auth disabled?** | **⚠ §2's whole local-mode design.** Some clients require a username |
| 3 | **Docker Desktop / WSL2 loopback semantics** for a `127.0.0.1:<port>` publish — `Get-NetTCPConnection -LocalPort <p>`, **plus an attempt to reach it from a non-loopback interface** | **⚠ the "no more exposed than DPAPI" argument in plan §2 rests entirely on this** |
| 4 | Is `CREATE DATABASE` genuinely Enterprise-only on this image? | D92's premise and D94's second correction |
| 5 | Free-port allocation: bind `127.0.0.1:0`, read, close, hand to Docker. **Accept and RECORD the TOCTOU window** rather than pretending it away | Stage 5 |
| 6 | **The MCP server under a Chorus-composed allow-list environment.** `composeChildEnv`'s credentialed branch emits only `PATH, SystemRoot, TEMP, TMP, HOMEDRIVE, HOMEPATH, USERPROFILE` + pins + the secret. `uvx`/`npx` resolve via `PATH`, **but `uv` caches under `%LOCALAPPDATA%`, which is not on the list** | Stage 4, and **an empirical `BASELINE_ENV_VARS` addition** |

**⚠ ITEMS 2 AND 3 ARE NOT RESEARCH, THEY ARE LOAD-BEARING.**

- **If the MCP server refuses an auth-disabled Neo4j**, plan §2's local-mode recommendation
  collapses and **the design falls back to env-var indirection in every mode** — which changes Task
  6-3's `auth_mode` handling and re-opens H3 for local mode. **Record it as a finding and amend
  Task 6-3's doc**, do not let 6-3's implementer discover it.
- **If the loopback publish is reachable off-host**, `NEO4J_AUTH=none` is no longer defensible and
  the argument in plan §2 is refuted by its own premise. Say that, rather than shipping the
  reasoning with a hole in it.

**⚠ ITEM 6 IS THE ONE D49 EXPLICITLY LEFT OPEN** — *"deeper features (MCP servers, plugin sync) were
not exercised and remain unknown."* **This phase is the phase that closes it.** Expect to need a
`BASELINE_ENV_VARS` addition; **record what broke without it**, and note that **D88's three-lists
trap (COPY-FROM / IMPOSE / REMOVE) applies to whoever edits that list** — `env.ts:10` is the
COPY-FROM one.

## 3. The brief

`CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance.md`, authored **against the code as it stands
now**, following `CouncilBrief-3b.0-ApiSessionProducer.md`'s shape: framing prose, then **numbered
questions**, then an evidence appendix.

**⚠ THE FIRST LINE, BEFORE ANY FRAMING:**

> **Answer these questions. Do not review this document.**

**This is not a stylistic flourish. It is a repeatedly-observed failure mode:** without it the
council reviews the brief instead of answering it, and the run is wasted. Put it first, in bold, and
repeat it immediately above the question list.

**⚠ THE QUESTIONS MUST BE NUMBERED `1.`, `2.`, … IN A FLAT LIST**, because `parseBriefQuestions`
extracts them structurally and the verdict-token machinery keys on `Q<n>`. A question buried in prose
is a question the structural detection arm cannot measure — and Phase 3e spent two runs measuring
exactly that arm. **Six questions maximum**; 3e's run resolved 5 of 6 structurally.

**The five questions, from plan §12** — put them close to verbatim, they were written for this:

1. **The `Plan.md` §10 corrections** (now **six**, per D102 — D94's four plus the generated-password
   step and the `agentdesk-` prefix). Are they right, and is anything else in §10 wrong?
2. **Is provenance advisory-and-measured, or enforced app-side?** *"Agents write via MCP directly"*
   means Chorus **cannot** enforce it — the write tool takes Cypher. Is `memory:validate`'s measured
   answer sufficient, or does v1 need app-mediated writes?
3. **The H3 environment-policy flip.** Is silently narrowing a subscription pane's environment
   acceptable with a UI disclosure, or does credentialed memory need a different mechanism?
4. **The D93 posture.** Does *"names not values"* genuinely hold the D49 line, or is it a
   rationalisation? **The plan names this the question most worth an adversarial read.**
5. **D92's cost.** One container per project at ~512 MB–1 GB heap each. At what project count does
   this stop being reasonable, and does the answer change the design?

**Add a sixth only if the D4 pass produced a genuine design fork** (most likely from item 2 or 3
above). **Do not pad to six.**

**The evidence appendix ships §10's results with the three-way split intact.** ⚠ An unmarked mix is
the D70 failure.

**⚠ DO NOT ASK THE COUNCIL TO WRITE CODE.** CR-3b.0's verbatim TypeScript shipped four compile
errors because the council had the brief and not the repo — the standing caveat in every findings
document says so. Ask for rulings and reasoning.

## 4. The run

- **State the envelope first: ~$2.20 authorised (D101), one run expected at ~$1.09 / ~21 min**, a
  second only if the first is refused before producing a document.
- **Watch it stream.** The roster is proven but `params_json` is create-only; a member with a wrong
  budget returns empty content and can abort the run on D67 Q6's two-member floor. **Verify the
  resolved budget before spending** — 3e-1 lost $0.037 to exactly this.
- **After it lands, open the transcript through the new `council:transcript` toggle.** The reader
  exists now (3e-4); a run whose transcript nobody re-reads was the problem D97 was filed for.
- **Report the cost as a bound and say which number you are quoting** — Chorus's own, or
  OpenRouter's billing page. Per D101 the old under-reporting cause is fixed, so Chorus's figure is
  no longer a floor *for that reason*; it is still unverified against billing.

## 5. Recording the outcome

The decision goes in the roadmap §6 table as **the next free number**, in the D33/D63 idiom:

- **The council's findings**, with **dissents preserved** — the document generates that section
  unconditionally, so quote it rather than re-summarising.
- **The coordinator's own resolutions, stated SEPARATELY and labelled as such**, because a council
  does not ratify itself. D33 has clauses (a)–(e) for exactly this reason.
- **Where the council was wrong, say so.** It cannot see the repo. If it rules against a checkable
  fact this phase verified, the fact wins and the ruling is recorded as overridden with the evidence.
- **Mark G5 closed in the roadmap**, naming the decision number that closed it.
- **Amend any task doc a finding invalidates**, in the same commit. **A finding that only lives in the
  investigation file is a finding the next implementer will not read.**

## 6. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
git status --porcelain -- src/ package.json package-lock.json   # EMPTY
```

**Runtime (G2): the council run IS the runtime proof.** It must also confirm, explicitly, that the
3e-4 transcript reader opens this run — one click, recorded — because that is the cheapest possible
regression check on the feature the previous phase just shipped.

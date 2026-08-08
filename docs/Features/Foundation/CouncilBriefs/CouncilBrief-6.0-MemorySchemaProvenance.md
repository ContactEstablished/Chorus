# Council Brief 6.0 — Memory schema and provenance for an agent-written knowledge graph

**Answer these questions. Do not review this document.**

_Issued 2026-08-07 · Status: AWAITING FINDINGS · Decision owner: Matthew Wilson_

You are a review council of independent LLM models. Answer the six numbered questions in section 3 —
section 4 elaborates on each in the same order — in the **Required Output Format** at the end. You
have no other context on this project — everything you need is in this document. Where you are
uncertain about an external fact, say so explicitly rather than guessing.

**Do not write code.** A previous council in this project returned verbatim TypeScript that shipped
four compile errors, because a council has the brief and not the repository. Rulings and reasoning
are what is wanted here.

Every factual claim below is labelled **[MEASURED]**, **[INSPECTED]** or **[UNVERIFIED]**. Those
labels are load-bearing: a previous failure in this project came from reasoning over an unmarked mix
of the three and producing confident findings about facts nobody had established. **Treat
[UNVERIFIED] claims as open, and say so if your answer depends on one.**

---

## 1. Context

**Chorus** is a local-first, bring-your-own-key Windows desktop app for running several AI coding
agents (Claude Code, OpenAI Codex, opencode, kimi) in parallel terminal panes. It is not a hosted
service; there is one user, on one machine, and no server.

**The feature under review.** Each project gets a **memory graph** — a Neo4j database holding what
the agents have learned about that codebase (files, classes, decisions, observations). Agents read
and write it through the **Model Context Protocol (MCP)**: Chorus configures each CLI agent to
launch a Neo4j MCP server, and the agent then calls that server's tools directly. Chorus is not in
the request path. **[MEASURED]** The server exposes exactly three tools: `get_neo4j_schema`,
`read_neo4j_cypher`, `write_neo4j_cypher`. The write tool takes **arbitrary Cypher**.

**The security posture this app already holds, which constrains everything below.** API keys are
encrypted at rest with Windows DPAPI and injected as environment variables into child processes at
launch. A standing rule — arrived at after an incident where an agent CLI silently preferred a
config-file key over the injected one — is that **no secret value is ever written into a CLI tool's
own config file, in any mode**. Not "not by default": never. Where a credential is needed, Chorus
writes the *name* of an environment variable into the config, and the value is resolved per launch
from the encrypted store. This is referred to below as the **"names not values" posture**.

**Two deployment modes are proposed:**

- **Local mode** — a Neo4j container per project with authentication **disabled**, published on
  `127.0.0.1` only. No password exists, so none can leak.
- **Credentialed mode** — an existing Neo4j the user already runs, reached with a password held in
  the encrypted store and passed by variable name.

**A hardware note that bears on question 5:** one Neo4j container per project, each with roughly
512 MB–1 GB of heap, on a single developer workstation.

---

## 2. What was measured on 2026-08-07, before this council convened

A probe pass ran against a real Neo4j container on the developer's machine. **The results changed
what these questions are worth asking about, so they are stated up front rather than buried in the
appendix.**

- **[MEASURED] Local mode works.** The Neo4j MCP server connects, reads and writes against a Neo4j
  with authentication disabled, given **no username and no password at all**. The design's own
  fallback plan — "if it refuses, use variable indirection in every mode" — is not triggered.
- **[MEASURED] The loopback publish is genuinely loopback-only.** The listener binds `127.0.0.1`
  exactly and was unreachable from all twelve non-loopback addresses on the machine, including its
  LAN address. A control against `127.0.0.1` succeeded, proving the test detects a reachable port.
- **[MEASURED] Credentialed mode works too, with controls.** Correct password via environment
  variable succeeds; wrong password fails; absent password fails.
- **[MEASURED] One database per project is impossible on the free edition.** `CREATE DATABASE` is
  refused outright on Neo4j 5.26.29 Community; exactly two databases exist and no third can be made.
  Isolation therefore has to come from the container boundary.

**⚠ [MEASURED] One finding cuts against the design and is the subject of question 6.** When Chorus
writes an MCP config file for Claude Code, that CLI reports the server as **"Pending approval"** and
states that unapproved servers are **"not connected to"**. Approving requires an interactive
session. **Writing the config file is necessary but not sufficient for the agent to use the memory
graph.**

---

## 3. The questions

**Answer these questions. Do not review this document.**

1. Should Chorus adopt the six listed corrections to its original memory specification, and is anything else in that specification wrong?
2. Should provenance be advisory-and-measured — a validator that reports how many memories lack a source — rather than enforced by routing all agent writes through Chorus?
3. Should enabling credentialed memory on a subscription-authenticated pane be allowed to narrow that pane's environment to a seven-variable allow-list, disclosed in the UI?
4. Does the "names not values" posture genuinely hold the security line it claims, or is it a rationalisation?
5. Should Chorus keep one Neo4j container per project, and at what project count does that stop being reasonable?
6. When Chorus writes an MCP config that the agent CLI will not use until a human approves it, should Chorus write the config and disclose the approval step rather than pre-approving on the user's behalf?

---

## 4. Notes on each, in order

**On question 1 — the six corrections.**

The original specification for this feature was written early and has since been superseded on six
checkable points. Each correction is stated with its reasoning; the question is whether they are
right, and whether anything else in the list below is wrong.

- **(a) Node uniqueness must be composite, not bare.** The spec makes `File.path` and `Class.fqn`
  unique. **[MEASURED]** This app's core feature is git **worktrees** — several working trees of the
  same repository checked out at once — so the same logical file legitimately exists at several
  paths, and several repositories may share a path. Corrected to `(File.repo, File.path)` and
  `(Class.repo, Class.fqn)`.
- **(b) "One database per project" is unachievable.** **[MEASURED]** Confirmed above:
  `CREATE DATABASE` is Enterprise-only. Corrected to one container per project.
- **(c) `confidence: number` is uncalibrated self-report.** An agent writing `confidence: 0.9` about
  its own claim is not measuring anything. The correction is to drop it.
- **(d) Three provenance fields must be edges, not string properties.** The spec stores the source of
  a memory as strings on the node. The correction makes them relationships to real nodes, so they can
  be traversed and validated rather than only read.
- **(e) A "generate a password, store it in the vault" step must go.** It manufactures a secret whose
  only purpose is to be handed to a config file — the exact thing the standing rule forbids. Local
  mode has no password at all.
- **(f) A stale product name in the container prefix.** Containers were named for a previous name of
  the app. The container name is the one string a human reads in Docker Desktop when deciding what
  to delete, so it is not cosmetic.

---

**On question 2 — provenance, and the crux of this whole review.**

The goal is that agent-written knowledge stays trustworthy and attributable: for any memory in the
graph you can tell which agent wrote it, when, in which session, and from what evidence.

**⚠ The uncomfortable fact is that Chorus cannot enforce this.** **[MEASURED]** Agents write via the
MCP server directly, and its write tool accepts arbitrary Cypher. An agent can create a node with no
provenance whatsoever, and Chorus never sees the statement. Enforcement would require **app-mediated
writes** — replacing the general-purpose MCP server with a Chorus-authored one exposing only
constrained, provenance-stamping operations.

The proposed alternative is **advisory-and-measured**: keep the general MCP server, and ship a
validator that reports, in the app, a figure of the form *"43 of 512 memories have no source."*
Never a bare "43" — a count without its denominator is treated in this project as worse than no
number at all.

Consider both directions honestly. Advisory is far cheaper, keeps a standard well-maintained server,
and lets agents use the full expressiveness of the graph — but it means the trust property is
*observed* rather than *guaranteed*, and a number nobody acts on is decoration. App-mediated writes
would make provenance structural, but Chorus would then own an MCP server, a schema-constrained write
API, and every future extension an agent wants that the API does not cover.

**If you recommend advisory-and-measured, say what makes the measurement actionable rather than
decorative** — what the app should do when the unsourced count is high, and whether any part of the
graph should be enforced even if the rest is not. **If you recommend app-mediated writes, say what is
lost** and whether a hybrid (constrained writes for a few node types, free Cypher elsewhere) is
coherent or merely a compromise.

---

**On question 3 — the environment-policy flip.**

**[MEASURED]** Chorus composes each child process's environment one of two ways, and it selects
between them on a single condition: *does this launch carry any secret?*

- **No secret** — the pane inherits the developer's full ambient environment, as a normal terminal
  would.
- **Any secret** — the pane gets a seven-variable allow-list (`PATH`, `SystemRoot`, `TEMP`, `TMP`,
  `HOMEDRIVE`, `HOMEPATH`, `USERPROFILE`) plus two pinned display variables plus the secret. Nothing
  else. This exists so that a pane holding one API key cannot also leak every other credential
  sitting in the developer's shell.

**The problem.** Some agents are authenticated by a subscription login rather than an API key, so
those panes carry no secret and today inherit everything. **Turning credentialed memory on for such a
pane would put a value in the secret set for the first time and silently flip it to the allow-list.**
The developer's ambient environment — every tool-specific variable their shell exports — vanishes
from a pane that worked yesterday, with no error.

The proposal is to **accept the flip and disclose it in the UI**. One tempting alternative is
explicitly rejected: routing the password through the app's *non-secret* environment channel would
avoid the flip by putting a secret into the channel defined as carrying no secrets, destroying the
invariant the split exists to maintain.

**Two facts that bound this question.** **[MEASURED]** Local mode has no password, so the secret set
stays empty and **this problem does not arise there at all** — it is specific to credentialed mode.
And **[MEASURED]** the allow-list has a measured sharp edge: with `APPDATA` absent, the `npx` command
silently resolves to a different, two-major-versions-older npm, exit code 0, no warning. So "the
allow-list is narrow but harmless" is not automatically true.

Is disclose-and-accept sufficient? Or does credentialed memory need a different mechanism — and if
so, what?

---

**On question 4 — the "names not values" posture. This is the question most worth an adversarial
read.**

The claim: writing an environment variable **name** into a CLI tool's config file, while the value
stays encrypted and is injected per launch, genuinely holds the line that "no secret reaches a config
file" — rather than merely relocating the secret by one hop and declaring victory.

**The strongest case for it.** The properties actually protected are concrete: no decrypted secret at
rest outside the encrypted blob; the vault keeps its lifecycle, so rotating or revoking a credential
takes effect everywhere at once instead of leaving stale copies in config files nobody remembers; and
a config file can be backed up, synced or committed to a repository without carrying a secret with
it. **[MEASURED]** One agent CLI supports this natively — it accepts a list of variable *names* to
pass through from the parent environment, distinct from a map of name-to-value.

**The strongest case against it.** The value still lands in the child process's environment, where it
is readable by anything that can inspect that process, and by the agent itself — which is an LLM that
may print its environment into a transcript. The config file is no longer the weak point, but a
determined attacker was never going to be stopped by that. One could argue the real protection comes
from the encryption and the process boundary, and that "names not values" is a rule that is easy to
state and audit but does little marginal work.

**Please argue the second position seriously before settling.** If the posture holds, say precisely
which threats it stops and which it does not. If it is a rationalisation, say what should replace it.
**Agreement with the design will not be treated as validation unless it engages the counter-argument.**

---

**On question 5 — the cost of one container per project.**

**[MEASURED]** The container image is 968 MB on disk; the running database wants roughly 512 MB–1 GB
of heap. One per project, on one developer workstation.

The design's argument for the container as the isolation unit has two limbs: **[MEASURED]** the free
edition cannot give a second database, so there is no lighter in-process boundary available; and the
container is **visible in Docker Desktop**, so the user can see exactly what is running, stop it, and
delete stale ones — the overhead is legible rather than hidden.

Against: a developer with fifteen projects is being asked for a lot of RAM for a feature that is
assistive rather than essential, and containers accumulate silently once created.

**At what project count does this stop being reasonable?** And does the answer change the design — a
shared instance with per-project label namespacing, on-demand start/stop tied to project focus, an
eviction policy, or something else? If you propose a shared instance, address what is lost when
projects are no longer isolated by a process boundary, given that the write tool accepts arbitrary
Cypher.

---

**On question 6 — the approval gate. This question exists because the probe pass found it; it was
not in the original design.**

**[MEASURED]** When Chorus writes a project-scoped MCP config file, Claude Code lists the server as
**"Pending approval"** and its own documentation states that unapproved servers are **"not connected
to."** Approval requires an interactive session with that CLI. So the sequence Chorus intends —
write the config, launch the agent, agent uses the memory graph — **has a human step in the middle
that the design does not account for.**

Three options, and the question proposes the first:

- **Write and disclose.** Chorus writes the config and tells the user, in the UI, that the agent will
  ask them to approve it once. Honest, but the feature is not "on" when the user turned it on.
- **Pre-approve on the user's behalf.** Chorus additionally writes whatever state that CLI uses to
  record approval. The feature works immediately — but Chorus would be writing another tool's
  *trust* state, not just its configuration, and defeating a prompt that exists so a human sees which
  MCP servers a coding agent may call. Note the standing rule in this project already limits what
  Chorus writes into other tools' files; whether it extends to approval state is genuinely open.
- **Treat the approval as the user's job entirely** and document it outside the app.

**[UNVERIFIED]** Whether the other agent CLIs impose a comparable gate is not established. Assume at
least one does.

The stated milestone for this work is *"agents read and write a per-project memory graph via MCP."*
If a human must approve once per project, say whether that milestone is met, and what the app should
show a user who enabled memory and is waiting for something to happen.

---

## 5. Evidence appendix

**⚠ The three-way split is deliberate. An unmarked mix of these categories is what produced a
previous failure in this project.**

### Live-probed on 2026-08-07 (strong)

| Fact | Result |
|---|---|
| Neo4j MCP server package | `mcp-neo4j-cypher` **0.6.0**, from PyPI, run via `uvx` |
| Tools exposed | `get_neo4j_schema`, `read_neo4j_cypher`, `write_neo4j_cypher` — write takes arbitrary Cypher |
| Connect with auth **disabled**, no credentials | **Succeeds** — read and write both |
| Connect with auth **enabled**, correct password via env var | **Succeeds** |
| Connect with auth enabled, **wrong** password | Fails, `Neo.ClientError.Security.Unauthorized` |
| Connect with auth enabled, **no** password | Fails, same error |
| `127.0.0.1` publish reachable off-loopback? | **No** — 12 non-loopback addresses all refused; loopback control succeeded |
| `neo4j:5-community` image | Exists; resolves to **Neo4j 5.26.29 Community**; 968 MB |
| APOC procedure library in that image | **Absent — zero procedures** |
| `CREATE DATABASE` on that image | **Refused:** "Unsupported administration command" |
| Databases available | Exactly two: `neo4j`, `system` |
| MCP server under the seven-variable allow-list | **Works** — connected, queried and wrote |
| `npx` under that allow-list | **Silently downgrades** 11.12.1 → 10.9.2 (global npm lives under `APPDATA`, which is not on the list) |
| Per-invocation MCP config on the codex CLI | Accepted, and **writes nothing** — config file byte-identical before and after |
| Env-var **name** passthrough (as distinct from name→value) | Supported natively by that CLI |
| Claude Code and a Chorus-written config | **"Pending approval… not connected to"** |
| Free-port allocation | Works; the reserve-then-hand-off race window measured at ≥9.33 ms and accepted |

### Binary-inspected only (weaker — could not be confirmed live, and why)

| Claim | Status |
|---|---|
| Claude Code expands `${VAR}` in MCP config values | Expansion machinery **is present** in the installed binary (the regex and a `missingVars` path are both visible). **Runtime behaviour not observed:** the CLI prints no resolved values, and an unapproved server is never connected to, so confirming it needs an interactive session. |
| opencode supports `{env:VAR}` / `{file:}` substitution and a config-path variable | All three tokens present in the installed binary. Semantics not exercised. |

### Unverified

| Item | Consequence |
|---|---|
| Whether agent CLIs other than Claude Code gate a written MCP config behind approval | Bears directly on question 6 |
| Behaviour on a cold package cache under the narrowed environment | The probe machine's cache was warm |
| Whether one agent CLI supports environment-variable indirection in MCP config at all | It stays unconfigured for memory until established |

---

## 6. Required Output Format

Answer each question separately, in this shape:

```
Q1: AGREE | DISAGREE | QUALIFY
<your reasoning, a few short paragraphs>

Q2: AGREE | DISAGREE | QUALIFY
<your reasoning, a few short paragraphs>

… through Q6.
```

Begin each answer with the verdict token on its own line as shown — the app counts those tokens to
summarise where the council agreed. Interpret **AGREE** as "yes, do the thing the question proposes",
**DISAGREE** as "no, do not", and **QUALIFY** as "yes, but only under conditions you then state".

For questions 5 and 6 the proposition also asks for a number or a choice; give it explicitly inside
your reasoning rather than leaving it implied.

**Answer these questions. Do not review this document.**

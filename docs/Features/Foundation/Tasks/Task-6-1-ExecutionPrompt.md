# Task 6-1 — Execution Prompt (paste into a fresh session)

*Authored 2026-07-28 against the code at `5a88b4f`. **Every fact, line number, count and gate below
was re-run while authoring this prompt, at this HEAD** — not inherited from the phase docs, which
were written two commits earlier.*

---

## Role

You are the **Coordinator** for **Chorus — Task 6-1: The Council Gate and the D4 Pass (Phase 6,
Stage 0)**.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main`. **Confirm it; do not switch or create a branch without instruction.**
- **Expected HEAD at start:** `5a88b4f` *("Chorus can be built into an installer you can carry to
  another computer")*.
- **Platform:** Windows 11, PowerShell primary. A Bash tool is also available; each takes its own
  syntax.

## Goal

Close **`[CR: memory schema + provenance model]`** — Phase 6's **G5** gate, which has never fired and
which **blocks all four remaining tasks in the phase** — and establish **by measurement rather than by
reading** the six facts `Phase-6-MemoryPlan.md` §10 lists as unverified.

**The deliverables are four documents and one decision. There is NO production code in this task.**
A 6-1 that touches `src/` has left its scope entirely.

---

## ⚠ Read this before anything else — five things you cannot infer

### 1. HEAD has moved two commits past the commit the phase docs were verified at

The Phase 6 task docs, the ImplementationSpecs and the roadmap's Phase 6 entry all say *"verified
2026-07-28 at `3fa295d`"*. **HEAD is now `5a88b4f`.** Two commits landed after the kickoff:

```
5a88b4f  Chorus can be built into an installer you can carry to another computer
32808be  Chorus no longer opens a folder that only exists on one developer's machine
1ac895f  Phase 6 is planned: give the agents a project memory, and prove nothing leaks   <- 3fa295d's successor
```

Between `3fa295d` and `5a88b4f` the only **code** touched was `src/main/index.ts` (32 lines), plus
`package.json`, `package-lock.json` and a new `electron-builder.yml`. **This session re-verified every
ground fact the Overview's table asserts, at `5a88b4f`, and they all still hold** — see §4 below.
**Do not re-derive them; do not assume they are stale either.** Where the docs say `3fa295d`, read
`5a88b4f`.

### 2. There is an uncommitted change in the tree that is NOT yours

```
 M src/renderer/src/components/TerminalPane.vue      (68 insertions, 5 deletions)
```

It is a **Phase 3c token-conformance restyle** of the clean-worktree close-offer strip — stock
Tailwind utilities swapped for `--color-*` tokens, plus a `<style>` block documenting each choice.
**Do not revert it, stage it, or commit it.** It is unrelated to Phase 6 and it must not appear in
your commit. Your commit stages **only** the files this task creates or edits, by path — never
`git add -A`, never `git commit -a`.

*(The baseline in §4 was measured **with this file dirty**, so its presence does not move any number.)*

### 3. ⚠ There is a second, live Chorus instance on this machine. Never blanket-kill Electron.

Matthew runs his **real** Chorus from **`C:\Chorus-Stable`**, against **its own database**. Killing
Electron by process name will destroy his working instance and his session state.

- Launch the dev app with `_verify/launch.ps1` (it restores `ComSpec` and rebuilds `PATH` from the
  registry first — the harness strips both) on `--remote-debugging-port=9222`.
- Kill **only** the dev instance, identified **by its command line containing `9222`**, and kill
  process **trees** (`_verify/killtree.ps1`, or `taskkill /PID <root> /T /F`).
- **Never** `Stop-Process -Name electron`, and never `taskkill /IM electron.exe`.
- If `9222` is already bound when you start, something else owns it — **stop and report**, do not
  take the port.

### 4. This task spends real money, and the envelope is stated before the run, not after

**~$2.20 authorised (D101, Matthew, 2026-07-28), covering two runs.** One run is expected at **~$1.09
and ~21 minutes** (measured on run `c06874ad`, the first full four-member run in the project's
history). The second run exists **only** for the case where the first is refused before producing a
document.

**State the envelope in your own words before you press Run, then measure against it.** When you
report the cost, **say which number you are quoting** — Chorus's own reported figure, or OpenRouter's
billing page. Per D101 the old under-reporting cause (a capped stream never receiving the frame
carrying `usage`) was fixed in 3e-2, so Chorus's figure is no longer a floor *for that reason* — but
it is still unchecked against billing, and saying so is part of the deliverable.

### 5. The council reviews the brief instead of answering it unless you tell it not to

This is a **repeatedly observed** failure mode, not a stylistic worry. The brief's **first line, before
any framing prose**, must read:

> **Answer these questions. Do not review this document.**

in bold, and it must be **repeated immediately above the numbered question list**. Check it literally
before you spend the money.

---

## Ground yourself first — read these before writing anything

**Phase and task docs (all paths relative to the repo root):**

| File | Why |
|---|---|
| `docs/Features/Foundation/Tasks/Task-6-1.md` | **Your task contract** — scope, non-goals, acceptance criteria, review checklist |
| `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6-1.md` | **Normative.** §1 the D4 re-probe, §2 the six unverified items, §3 the brief, §4 the run, §5 recording the outcome |
| `docs/Features/Foundation/Tasks/Phase-6-Overview.md` | The purity contract, the verified-ground-facts table, **D100 / D101 / D102** |
| `docs/Features/Foundation/Phase-6-MemoryPlan.md` | **Authoritative on design.** Read **§2** (the security design + H1–H3), **§4** (where `Plan.md` §10 is wrong), **§10** (the D4 obligations you are re-running) and **§12** (what the brief must contain) |
| `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.0-ApiSessionProducer.md` | **The format precedent** — the shape your brief copies |
| `docs/Features/Foundation/Investigations/3e-2-Proving-Run.md` | What a good investigation document looks like, and where the $1.09 / 21 min figure comes from |
| `docs/Features/Foundation/roadmap.md` | §4 (the CR mechanism), §6 **Decisions** table and **Gates** table, §7 the **Phase 6** entry (line ~1158), and the *"How to run the next step"* block (line ~1234) |
| `CLAUDE.md` | The standing rules — including *"CLI agent flags move fast; verify against the tool's own docs/`--help`"*, which is this task's whole premise |

**Code you must look at (do not edit any of it):**

| Fact | Location — **re-verified at `5a88b4f`** |
|---|---|
| `McpDescriptor` — file-shaped `{mode, format, location, configPath}` | `src/main/adapters/types.ts:88` |
| `McpServerRef` — `{name, command, args}`, **no `env` field** | `src/main/adapters/types.ts:337` |
| `writeMcpConfig` — returns `Promise<void>`, no refusal channel | `src/main/adapters/types.ts:344` |
| `supportsMcp` type guard | `src/main/adapters/types.ts:383` |
| The argv-is-world-readable note (comment `168–173`, on `extraArgs`) | `src/main/adapters/types.ts:174` |
| `BASELINE_ENV_VARS` — the **COPY-FROM** list (D88's three-lists trap) | `src/main/adapters/env.ts:10` |
| The `composeChildEnv` policy flip | `src/main/adapters/env.ts:142` |
| The capability-honesty adapter list — **`[claudeAdapter, codexAdapter]`, 2 of 5** | `src/main/adapters/adapters.test.ts:41` |
| `headersContainSecret` — the refuse-the-write precedent | `src/main/ipc.ts:252` (def) · `:1375`, `:1400` (calls) |
| `MIGRATIONS` array | `src/main/services/storage.ts:75` |
| `findingsPathFor` + the non-clobbering suffix logic | `src/main/services/councilService.ts:364`, `:389` |

**⚠ Two corrections to the Overview's own fact table, found while authoring this prompt (2026-07-28,
at `5a88b4f`):**

- **`storage.ts` is at `src/main/services/storage.ts`, not `src/main/storage.ts`.** The Overview cites
  it bare (`storage.ts:75`, `storage.ts:1655`, `:1750`); `src/main/` contains only `constants.ts`,
  `index.ts` and `ipc.ts`. The wrong directory is a real dead end — the same class of error D102 was
  filed for.
- **`package.json` lists SEVEN runtime dependencies, not eight.** They are `@electron-toolkit/preload`,
  `@electron-toolkit/utils`, `better-sqlite3`, `node-pty`, `pino`, `splitpanes`, `zod`. D100 and the
  plan §11 both say *"an app with 8 runtime deps"* and *"8 → 9"*. **The `neo4j-driver` count is
  therefore 7 → 8, in Task 6-3.** This changes nothing in *this* task (which adds no dependency) but
  it is a checkable fact stated wrongly in two places, so **record it** — either in the D4 pass
  document or in your decision — rather than letting 6-3's implementer trip over it.

**Git checks to run before you touch anything:**

```bash
git branch --show-current && git log --oneline -1 && git status --porcelain
```

Expected: `main` · `5a88b4f …` · exactly one line, ` M src/renderer/src/components/TerminalPane.vue`.
**If anything else is dirty, stop and report before proceeding** — something changed between this
prompt being written and you starting.

---

## The baseline, measured 2026-07-28 at `5a88b4f` with `TerminalPane.vue` already dirty

| Gate | Value |
|---|---|
| `npm run typecheck` | **exit 0**, zero errors |
| `npx vitest run` | **1055 passed (1055) · Test Files 30 passed (30)** |
| `npm run grep:secrets` | **clean** — *"6 patterns over src/, scripts/, _verify/, package.json, root configs"* |
| Runtime dependencies in `package.json` | **7** |
| `IpcChannel` members (`src/shared/ipc.ts:13–222`) | **58** |
| `MIGRATIONS.length` | **12** |
| `sqliteTable(` in `src/main/db/schema.ts` | **16** |

**This task must not move a single one of them.** The test count in particular: `1055 across 30
files`, and the rule is **"never fewer"**. If it moves, you touched something outside your scope.

---

## Implementation scope — six steps, in order

### Step 1 — Re-run every `Plan.md` §10 D4 probe, recording the METHOD, not just the answer

**The three-way provenance split IS the deliverable** (spec §1), not a formatting preference. For every
fact record **the exact command run, the date, and the raw answer** — not a summary.

**1a. The version pass.** `<tool> --version` for: `codex`, `claude`, `opencode`, `kimi`, `docker`,
`uvx`, `uv`, `npx`. At kickoff on 2026-07-28 these read **codex 0.145.0 · claude 2.1.218 · opencode
1.18.8 · kimi 0.29.1 · docker 28.0.4 · uvx/uv 0.11.19 · npx 11.12.1**, all on PATH. **Re-probe anyway
and report drift** — that is the entire point of the rule, and the plan was authored the same day as
the kickoff so it has had no chance to drift *yet*.

**1b. The linchpin — run this FIRST, before anything else in the task:**

```bash
codex mcp list --json -c 'mcp_servers.chorus_probe.command="uvx"' -c 'mcp_servers.chorus_probe.args=["--help"]'
```

*(PowerShell quotes `-c` arguments differently — if the shell mangles them, use the Bash tool, and
record which shell produced the answer.)*

**⚠ If codex no longer accepts per-invocation `-c mcp_servers.…`, Stage 1 is no longer a zero-write
commit and the whole staging premise of Phase 6 has failed.** Say so **loudly**, at the top of your
report. **Do not work around it, and do not proceed to author a brief that assumes it.**

**Also confirm it writes nothing:** hash `~/.codex/config.toml` before and after the probe and compare.
Record both hashes.

**1c. Confirm the two binary-inspected claims LIVE** — Stage 4 depends on both:

- **claude `${VAR}` expansion.** Write a `.mcp.json` in a **scratch directory** (your session
  scratchpad — never in this repo), then `claude mcp get <name>`, and read back (i) whether the var
  expanded, and (ii) whether an **unset** var is reported as `missingVars` and left literal.
- **opencode `{env:VAR}` substitution**, and whether `OPENCODE_CONFIG` names a **file path** rather
  than a directory.

### Step 2 — Establish the six unverified items (spec §2)

| # | Item | Gates |
|---|---|---|
| 1 | `neo4j:5-community` — does the tag exist, which major does it resolve to, **and is APOC needed for v1 at all** (drop it unless a seed statement requires it) | Stage 5, and 6-4's seed list |
| 2 | **The Neo4j MCP server** — real package name, registry (`uvx`/PyPI vs `npx`/npm), exact env var names (`NEO4J_URI` vs `NEO4J_URL`, `NEO4J_USERNAME` vs `NEO4J_USER`, `NEO4J_DATABASE`) — **and critically, does it connect at all with auth disabled?** | **⚠ §2's whole local-mode design** |
| 3 | **Docker Desktop / WSL2 loopback semantics** for a `127.0.0.1:<port>` publish — `Get-NetTCPConnection -LocalPort <p>`, **plus an actual attempt to reach it from a non-loopback interface** | **⚠ the "no more exposed than DPAPI" argument rests entirely on this** |
| 4 | Is `CREATE DATABASE` genuinely Enterprise-only on this image? | D92's premise, D94's second correction |
| 5 | Free-port allocation — bind `127.0.0.1:0`, read, close, hand to Docker. **Accept and RECORD the TOCTOU window** rather than pretending it away | Stage 5 |
| 6 | **The MCP server under a Chorus-composed allow-list environment.** `composeChildEnv`'s credentialed branch emits only `PATH, SystemRoot, TEMP, TMP, HOMEDRIVE, HOMEPATH, USERPROFILE` + pins + the secret. `uvx`/`npx` resolve via `PATH`, **but `uv` caches under `%LOCALAPPDATA%`, which is not on the list** | Stage 4, and an **empirical** `BASELINE_ENV_VARS` addition |

**⚠ ITEMS 2 AND 3 ARE LOAD-BEARING, NOT RESEARCH.**

- **If the MCP server refuses an auth-disabled Neo4j**, the plan §2 local-mode recommendation collapses
  and the design **falls back to env-var indirection in every mode** — which changes Task 6-3's
  `auth_mode` handling and re-opens H3 for local mode. **Record it as a finding AND amend
  `Tasks/Task-6-3.md` in this same commit.** Do not leave 6-3's implementer to discover it.
- **If the loopback publish is reachable off-host**, `NEO4J_AUTH=none` is no longer defensible and the
  plan §2 argument is refuted by its own premise. **Say that plainly**, rather than shipping reasoning
  with a hole in it.

**⚠ Item 6 is the one D49 explicitly left open** — *"deeper features (MCP servers, plugin sync) were
not exercised and remain unknown."* This phase is the phase that closes it. Expect to need a
`BASELINE_ENV_VARS` addition; **record what broke without it**, and note that **D88's three-lists trap
(COPY-FROM / IMPOSE / REMOVE) applies to whoever eventually edits that list** — `env.ts:10` is the
COPY-FROM one. **You do not make that edit in this task.**

### Step 3 — Write `docs/Features/Foundation/Investigations/6-1-D4-Pass.md`

The directory exists (it holds `3e-1-Measurement.md`, `3e-2-Proving-Run.md`). Use **these exact
headings**, in this order (spec §1):

```markdown
## Live-probed (strong)
## Binary-inspected only (weaker — confirmed / refuted live)
## Established this session (was: not verified at all)
## Still unverified, and what that blocks
```

**Every fact carries how it was obtained and on what date.** ⚠ *"A council reasoning from an unmarked
mix of live-probed, binary-inspected and unverified facts produces confident findings about facts
nobody established"* — the **D70 failure**, which came one ratification away from being adopted into
the roadmap as fact.

### Step 4 — Author `docs/Features/Foundation/CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance.md`

Shape it after `CouncilBrief-3b.0-ApiSessionProducer.md`: **framing prose → numbered questions →
evidence appendix**, authored **against the code as it stands now**.

**⚠ First line, before any framing, in bold:** *"Answer these questions. Do not review this document."*
**Repeat it immediately above the question list.**

**⚠ The questions must be numbered `1.`, `2.`, … in a FLAT list.** `parseBriefQuestions` extracts them
**structurally** and the verdict-token machinery keys on `Q<n>`. A question buried in prose is a
question the structural detection arm cannot measure — and Phase 3e spent two runs measuring exactly
that arm; 3e's run resolved 5 of 6 structurally. **Six questions maximum. Do not pad to six.**

**⚠ AND THE BRIEF MUST CARRY A QUESTIONS HEADING, OR EVERY NUMBERED LIST IN THE DOCUMENT BECOMES A
QUESTION.** Read `src/main/services/councilCore.ts:427–500` before authoring — the extraction is
narrower and more literal than it looks:

- `questionsSectionOf` finds the **first** heading whose *subject* contains the word `questions`, and
  scopes extraction to it, **down to the next heading at the same level or shallower**. The subject is
  computed by stripping a leading section number and then **dropping everything after an em-dash,
  en-dash or colon** — which is deliberately why `## 4. Binding prior rulings — constraints on your
  answer, not open questions` does **not** match. Give the section a plain heading like
  `## 5. The questions`.
- **If no such heading exists, the fallback is THE WHOLE DOCUMENT** — every `1.` anywhere in your
  framing prose or evidence appendix is then harvested as a question. `CouncilBrief-3b.0` has three
  other numbered lists in it; it survives only because it has the heading.
- Within that section, an item matches `^(\d{1,2})[.)]\s+(.+)$` after leading `>`, `-`, `*`, `+` and
  whitespace are stripped, and the remaining text must be **≥ 8 characters** once `**` is removed.
- `assembleRun` **refuses the run outright** if zero questions parse (`councilCore.ts:203`), with the
  message *"This brief has no numbered questions."* **A refusal before any paid call costs nothing —
  but only if you notice it is a refusal rather than a failure.**

**The five questions, close to verbatim from plan §12 — they were written for this:**

1. **The `Plan.md` §10 corrections — now SIX, per D102** (D94's four, plus the `generated password →
   vault` step that **D93 rejects**, plus the stale `agentdesk-neo4j-<slug>` container prefix where
   **D92 specifies `chorus-neo4j-<slug>`**). Are they right, and is anything else in §10 wrong?
2. **Is provenance advisory-and-measured, or enforced app-side?** *"Agents write via MCP directly"*
   means Chorus **cannot** enforce it — the write tool takes Cypher. Is `memory:validate`'s measured
   answer sufficient, or does v1 need app-mediated writes?
3. **The H3 environment-policy flip.** Is silently narrowing a subscription pane's environment
   acceptable with a UI disclosure, or does credentialed memory need a different mechanism entirely?
4. **The D93 posture.** Does *"names not values"* genuinely hold the D49 line, or is it a
   rationalisation? **The plan names this the question most worth an adversarial read.**
5. **D92's cost.** One container per project at ~512 MB–1 GB heap each. At what project count does
   this stop being reasonable, and does the answer change the design?

**Add a sixth ONLY if the D4 pass produced a genuine design fork** — most likely out of item 2 or 3.

**The evidence appendix ships §10's results with the three-way split intact.**

**⚠ DO NOT ASK THE COUNCIL TO WRITE CODE.** CR-3b.0's verbatim TypeScript shipped four compile errors
because the council had the brief and not the repo. **Ask for rulings and reasoning.**

**⚠ Do not answer the brief's own questions in the brief.** The brief asks; the council answers.

### Step 5 — State the envelope, then run the council (spec §4)

**The council runs natively in Chorus. This is the G2 runtime proof for this task.**

1. Launch the dev app (`_verify/launch.ps1`, port **9222**) — see §3 of the warnings above about the
   `C:\Chorus-Stable` instance.
2. Reach the council view: **`Ctrl+Shift+K`**, or `Ctrl+K` → the palette lists **Council**. *(It is
   deliberately not in the top-bar toggle.)*
3. **`Choose brief…`** (`data-testid="council-choose-brief"`) → your new brief.
4. **⚠ Verify the resolved budget of all four members BEFORE pressing Run.** The roster is proven — 4
   members, one OpenRouter credential profile, `params_json` `{"max_tokens":16000}` and **32000** for
   the arbiter — but **`params_json` IS SETTABLE AT CREATE ONLY**: `updateCouncilMember` takes only
   `{id, label}`. A member with a wrong budget returns empty content and can abort the run on D67
   Q6's two-member floor. **3e-1 lost $0.037 to exactly this.** Fixing it means deleting and
   recreating all four.
5. **State the envelope** (~$2.20 authorised; ~$1.09 / ~21 min expected), then **`Run council`**
   (`data-testid="council-run"`). **Watch it stream.**
6. Findings land automatically beside the brief as
   `CouncilBrief-6.0-MemorySchemaProvenance-Findings.md`. **Main derives the path and will suffix
   (`-Findings-2.md`) rather than clobber — do not author the findings file by hand.**
7. **After it lands, open the stored transcript** through the 3e-4 segmented toggle in the findings
   pane (`data-council-pane-transcript`). **Record that you did, in one line.** A run whose transcript
   nobody re-reads is the problem D97 was filed for, and this is the cheapest possible regression
   check on the feature the previous phase just shipped.
8. Record the **run id**.

### Step 6 — Record the outcome in the roadmap (spec §5)

**The decision goes in the roadmap §6 Decisions table as the next free number — currently `D102` is the
highest, so expect `D103`. Re-check before writing it.** Use the **D33/D63 idiom**:

- **The council's findings, with dissents preserved.** The findings document generates a
  `## Dissents preserved` section **unconditionally** — **quote it rather than re-summarising**.
- **Your own resolutions, stated SEPARATELY and labelled as such.** A council does not ratify itself;
  D33 has clauses (a)–(e) for precisely this reason.
- **Where the council is wrong, say so.** It cannot see the repo. If it rules against a checkable fact
  this phase verified, **the fact wins**, and the ruling is recorded as overridden **with the
  evidence**.
- **Question 4 (the D93 posture) must be reported honestly.** If the council merely *agreed* with it,
  **say that plainly** rather than treating agreement as validation. The plan named it the question
  most worth an adversarial read; a unanimous nod is a weaker result than a survived attack, and the
  record should show which one happened.
- **Cost, as a bound, saying whose number it is.**

**Then close the gate, in all the places the roadmap tracks it:**

- The **§6 Gates table** row for **G5** (roadmap line ~410).
- The **Phase 6 heading** (line ~1158) — currently `**[CR: memory schema + provenance model — ⚠
  UNFIRED, AND IT BLOCKS]**`. Mark it **closed, naming the decision number that closed it**, in the
  idiom the completed phases use (e.g. Phase 3b's `**[CR-3b.0 CLOSED as D63 …]**`).
- The **Phase 6 task table** (line ~1166) — 6-1 moves to landed, 6-2 becomes next.
- The **"How to run the next step"** block (line ~1234) — its `⚠ CURRENT POSITION` paragraph is the
  line a future session reads first, and it currently says the next step is 6-1.

**⚠ And amend any task doc a finding invalidates, in the same commit.** A finding that lives only in
the investigation file is a finding the next implementer will not read.

---

## Strict non-goals

- **⚠ NO PRODUCTION CODE. NONE.** Not a type, not a test, not a `package.json` line, not a
  `scripts/` file. If a D4 probe needs a script, **it goes in the session scratchpad** — never in
  `src/`, `scripts/` or `_verify/`.
- **Do not install `neo4j-driver`.** D100 approves it **for Task 6-3 only**.
- **Do not install `dockerode`.** ⚠ **D100 explicitly does NOT approve it.** The plan §11 defers the
  `dockerode`-vs-`docker`-CLI question to **Stage 5**, as a numbered decision made then.
- **Do not change the deliberation protocol.** D67 is closed. This task *uses* the council; it does
  not redesign it.
- **Do not edit `Plan.md`.** D102 rules it annotated via the roadmap — the D42/LiteLLM precedent.
- **Do not do any of Task 6-2's work.** No `types.ts` edits, no `mcpConfigCore.ts`, no widening of
  `adapters.test.ts:41` from 2 adapters to 5. That is 6-2's, and it is gated behind this task.
- **Do not revert, stage or commit `src/renderer/src/components/TerminalPane.vue`.**
- **Do not push, and do not open a PR**, unless explicitly asked.

---

## Required workflow

1. **Coordinator pattern.** You own the outcome. Ground yourself in the docs above **before** editing
   anything. This repo has **no `.codex/workflows/subagents/` kit** — do not go looking for one.
2. **The empirical probes are yours personally.** They are short, they are the whole point of the
   task, and a delegated probe whose method you did not watch cannot honestly carry a provenance
   label. If you delegate any drafting, **re-verify every factual claim it produces against your own
   raw command output** before it enters a document.
3. **Review your own deliverable against `Task-6-1.md`'s Review Checklist before committing** — all six
   items, explicitly:
   (1) `git diff --stat -- src/` is empty · (2) the three-way split is intact · (3) the brief's first
   line tells the council to answer rather than review · (4) the decision separates the council's
   findings from your resolutions · (5) the cost figure says whose number it is · (6) Question 4 got an
   adversarial read, honestly reported.
4. **One intentional, narrated commit (G3)**, in the house style: a plain-English title a
   non-technical reader understands, then the technical detail. Stage **by path**.
5. **Do not push or open a PR unless explicitly asked.**

---

## Verification commands — runnable as written from the repo root

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

Expected: exit 0 · **1055 passed (1055), 30 files** · `G4 secret-grep: clean (6 patterns over src/, scripts/, _verify/, package.json, root configs)`.

**The purity gate — this is the whole claim of the task:**

```bash
git status --porcelain -- src/ package.json package-lock.json scripts/
```

Expected: **exactly one line**, ` M src/renderer/src/components/TerminalPane.vue` — the pre-existing
change described above, which you did not touch. **Nothing else. No dependency added.**

```bash
git diff --stat -- src/ package.json package-lock.json
```

Expected: **only** the `TerminalPane.vue` line (68 insertions, 5 deletions), unchanged from when you
started.

**The document gates:**

```bash
grep -c "^## Dissents preserved" docs/Features/Foundation/CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance-Findings.md
```

Expected: **exactly `1`**. *(If the run produced `-Findings-2.md` because a first attempt already wrote
`-Findings.md`, check that file instead and say so.)*

```bash
grep -n "Answer these questions" docs/Features/Foundation/CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance.md
```

Expected: a hit **in the first 20 lines**, and a second hit immediately above the question list.

```bash
grep -nEi "^#{1,6} .*questions" docs/Features/Foundation/CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance.md
```

Expected: **at least one heading whose subject is `questions`** — without it, `parseBriefQuestions`
falls back to the whole document. *(A heading like `… — not open questions` does not count: the
qualifier after the dash is dropped before the word is looked for.)*

**⚠ This grep is a shape check, not the parser.** The authoritative check is to read the flat numbered
list **under that heading** and confirm it is **5 or 6 contiguous items**, each ≥ 8 characters, with
no numbered sub-list nested inside the section. `grep -nE "^[0-9]+\."` over the whole file will also
match numbered lists in your framing prose — that is expected and harmless **only because** the
heading scopes extraction.

```bash
grep -n "^## Live-probed (strong)$\|^## Binary-inspected only\|^## Established this session\|^## Still unverified" docs/Features/Foundation/Investigations/6-1-D4-Pass.md
```

Expected: **all four headings present**, in that order.

**Runtime (G2): the council run IS the runtime proof.** Report the run id, member count answered /
refused, turn count, duration, and the cost — and confirm in one line that the **3e-4 transcript
reader opened this run** (one click, recorded).

---

## Failure honesty clause

**If a verification command fails for an unrelated environment reason — a missing tool, a port
conflict, Docker Desktop not running, an OpenRouter outage — capture the exact output, explain what
happened, and do NOT claim success.** Report the gate as failed-with-explanation.

The same applies to the probes themselves. **A D4 answer you could not obtain is a finding**, and it
belongs under `## Still unverified, and what that blocks` with the reason. **An unverified fact
recorded as verified is the single worst outcome this task can produce** — it is the D70 failure,
and it nearly became roadmap fact once already.

**And if the codex `-c mcp_servers.…` linchpin has regressed, that is a STOP-AND-REPORT, not a
work-around.** The entire zero-write staging premise of Phase 6 rests on it.

---

## Final reporting requirements

End with a structured report containing **all** of the following:

1. **Status** — exactly one of **`DONE`** / **`DONE_WITH_CONCERNS`** / **`NEEDS_CONTEXT`** /
   **`BLOCKED`**.
2. **Files changed** — every path created or edited, with a one-line reason each. **Expected:**
   `CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance.md` (new) ·
   `CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance-Findings.md` (written by the app) ·
   `Investigations/6-1-D4-Pass.md` (new) · `roadmap.md` (edited) · **plus any task doc a finding
   forced you to amend**.
3. **The D4 results table** — every probe, its **method**, its **date**, and its **provenance label**.
   Call out **every drift** from the kickoff figures.
4. **The two load-bearing answers, stated first and plainly:** does the Neo4j MCP server connect with
   auth disabled, and is the `127.0.0.1` publish reachable off-host? **If either answer breaks the
   design, say which task docs you amended.**
5. **Build results** — `typecheck`, `vitest` (the actual counts), `grep:secrets`, each with what you
   actually observed.
6. **Runtime results** — the council run id, members answered/refused, turns, wall-clock duration, and
   **the cost as a bound with whose number it is**, measured against the ~$2.20 envelope. Plus the
   one-line transcript-reader confirmation.
7. **Review outcomes** — your pass against all six Review Checklist items in `Task-6-1.md`, item by
   item.
8. **Non-goals confirmation** — explicitly: no code under `src/`, no dependency added, `Plan.md`
   untouched, `TerminalPane.vue` untouched, no 6-2 work done.
9. **The decision as recorded** — its number, and a two-line summary separating **the council's
   findings** from **your resolutions**.
10. **G5 closure** — the exact roadmap locations you edited to mark it closed, and the decision number
    named in each.
11. **Residual risks and anything still unverified**, with what each one blocks downstream.
12. **Final `git status --porcelain` and `git log --oneline -3`**, verbatim.

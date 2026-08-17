# Architect pass — close Phase 6a and open Phase 5

_Authored 2026-08-16 for a FRESH session. Everything needed is in this file; it
assumes no memory of the conversation that produced it._

You are running step 5 of the roadmap's §3 rhythm — the `/architect` pass that
re-syncs `docs/Features/Foundation/roadmap.md` to reality after a phase lands.

**Invoke the `architect` skill and follow it.** This document is the input, not
a replacement for it.

---

## ⚠ READ THIS BEFORE YOU WRITE A SINGLE NUMBER

Every counter below is a **measurement with a date on it, not a constant.**
G6 exists because this project has had four `IpcChannel` collisions, two
migration-version collisions (one shipping a silent runtime failure) and one
decision-log collision. **Recompute every number against `main` at the moment
you write it — including the numbers in this file.** If what you measure differs
from what is written here, what you measure wins, and say so in the row.

The `MIGRATIONS` array cannot be grepped: comments *between* its elements
contain backticks, so a character scanner treats a comment as a template
literal and every count after it is garbage. Parse it with the TypeScript AST,
or read the highest `// vN` marker.

---

## What landed

**Phase 6a — Memory In Practice — is COMPLETE. All four tasks shipped and were
driven on the real app.**

| Task | Commit | Date | What it did |
|---|---|---|---|
| 6a-1 | `3c0e82e` | 2026-08-15 | The usage contract — claude and codex are told the graph exists |
| 6a-2 | `78c0893` | 2026-08-15 | `index-codebase` — File/Directory/Commit upserts, graph migration v2 |
| 6a-3 | `b2b73df` | 2026-08-16 | **F75 closed** — codex's argv actually carries the memory server |
| 6a-4 | `4369954` | 2026-08-16 | The provisioner — one-button Neo4j container + lifecycle UI |

HEAD is `4369954`, pushed to `origin/main`, working tree clean.

Evidence: `_verify/6a-3/RESULTS.md` and `_verify/6a-4/` (D4 probe output, the
binding proof, the F49 round trip, eight UI screenshots, nine drive transcripts).

### Ground facts, measured at `4369954` — RE-MEASURE, do not copy

| Fact | Value |
|---|---|
| `IpcChannel` keys | **97** (test-enforced twice in `src/shared/ipc.test.ts`) |
| `ipcMain.handle(` | **87** (97 − 10 event channels) |
| `MIGRATIONS.length` | **20** — next free is **v21** |
| `sqliteTable(` | **19** |
| Runtime dependencies | **8** — unchanged across all of Phase 6a |
| `LATEST_GRAPH_VERSION` | **2** |
| vitest | **2230 / 2230 across 66 files** (2012/59 at the phase's kickoff baseline) |
| typecheck | **0** (node + web) |
| `grep:secrets` | clean, 6 patterns |
| Highest decision | **D153** → next free **D154** |
| Highest finding | **F76** → next free **F77** |

---

## The rulings to record (Matthew's, this session)

### D154 — Phase 5 runs ahead of Phase 4's remainder

**This is the load-bearing one.** D147(g) currently queues Phase 4's three
remaining tasks (4-2 Attention Inbox, 4-3 notification policy, 4-4 OS delivery)
immediately after 6a. Matthew ruled that **Phase 5 — Voice Input goes next
instead.** The standing rule (`roadmap.md:1894`) is that a phase moves in the
queue only via a numbered decision recording the user's ruling — so write it.

**Carry forward:** Phase 4's `Task-4-2` execution prompt is already written, and
D147(g) already warns its `IpcChannel` figure and line numbers must be
re-measured when picked up. Phase 5 will move the tree further under it, so that
re-measure is now mandatory rather than advisory.

### Phase 5 scope decisions (number them as the pass sees fit)

- **v1 ships the offline floor PLUS the three refinement modes.** Verbatim +
  local whisper (no network, no key, no LLM) *and* Verbatim / Clean up /
  Organize over the existing BYOK path. **Cloud STT is OUT of v1** — so the D4
  pass drops the "cloud STT vendor API shapes" row.
- **The Fleet Switcher overlay is SPLIT OUT of Phase 5.** It was bundled because
  it shares always-on-top window plumbing with the mic overlay; the plumbing is
  real but small, and Phase 5 already grew without re-estimation (D135).
- **Refinement spend is METERED.** `onUsage` wired and persisted; where the
  numbers land is settled at kickoff. See the correction below — this is not a
  default, because the newest precedent records nothing.
- **The CR gate runs on Chorus's own in-app council**, on the **installed** app
  (`%APPDATA%\chorus-app`), which has 5 configured members and two OpenRouter
  credential profiles. The dev instance has zero of each.

---

## Corrections the pass must make to the roadmap itself

### 1. §4 is stale about the council — two clauses are now false

`roadmap.md:44` still says **"Claude cannot run the council"** and that
**"until 3b lands, CR runs stay in Cursor exactly as described here."**
**Phase 3b landed 2026-07-26.** `councilService.ts`, `councilCore.ts`, 15
council IPC channels and a brief-in/findings-out pipeline all ship, and the
installed app has 5 configured members.

**What does NOT change:** §4's four obligations, which apply whichever council
runs — **flag**, **prepare a brief**, **pause at the checkpoint**, and **record
findings in the §6 decision log** before continuing. Rewrite the mechanism, keep
the discipline.

### 2. The "How to run the next step" block is stale

`roadmap.md:1713` still says **"THE NEXT STEP IS TASK 6a-1"** with a baseline of
`IpcChannel` 86 / `MIGRATIONS.length` 19 / vitest 2012. All four are wrong. It
should point at Phase 5's D4 pass.

### 3. The Phase 6a heading is stale

`roadmap.md:1626` reads **"IN PROGRESS: 6a-1 AND 6a-2 LANDED; 6a-3 AND 6a-4
REMAIN"**. All four have landed.

### 4. `usage_records` does not exist and never did

`Plan.md` §9 and the Phase 5 roadmap entry both say voice refinement spend
*"rides `usage_records`"*. **`schema.ts:238` and `storage.ts:264-268` state
outright that the name was superseded.** Spend lives on `dispatches`,
`council_messages` and `council_runs`. The newest consumer — the day-report
summarizer at `ipc.ts:4135-4171` — passes **no `onUsage` at all** and records
nothing. Correct both documents, and note that metering voice is therefore a
decision (taken: meter it) rather than a default.

---

## Findings to number

### F77 — codex normalises the MCP server name, and 6a-1's text disagrees

Chorus emits `-c mcp_servers.chorus-memory.*`; **codex exposes the server as
`chorus_memory`** (underscore). Measured live in the 6a-3 drive: codex answered
*"Three MCP servers are currently available"* and listed `### chorus_memory`.
Meanwhile 6a-1's instruction snippet tells the agent the server is called
`"chorus-memory"` — a string codex never displays.

Cosmetic for dispatch (the model reads the real namespace and it worked — codex
answered a graph question correctly), but it needs a decision rather than a
discovery: either emit an underscore name, or accept the mismatch knowingly.
Note `CHORUS_MEMORY_SERVER` in `memoryService.ts` is deliberately hyphenated and
is the key `.mcp.json` merges replace, so renaming is not free.

### F78 — the suite's 5s default vs 46 uncached `where.exe` spawns

`adapters.test.ts` calls `buildLaunch` 46 times; **every call runs `resolveCli`
→ `execFileSync('where.exe', …)`**, a synchronous process spawn. Under the full
parallel suite one occasionally exceeds vitest's 5000ms default, failing
whichever unrelated claude argv test happens to be holding it.

Measured: the failure moved between **different** tests run to run, always at
5.2–5.5s, never when `adapters.test.ts` ran alone, and never on a stashed clean
tree (3/3 green). Attributed by stashing, not guessed.

**`resolveCli` is deliberately NOT memoised** — `cliDetect.ts:176` documents
that a launch resolves the binary fresh on every spawn so an agent upgraded
mid-session is picked up. So there is no product defect, and the fix was the
test budget: `testTimeout: 20_000` in `vitest.config.ts`, landed in `b2b73df`.
Record the finding anyway: the fragility is structural and the next person to
add `buildLaunch` calls should know why that timeout exists.

---

## Scope deviations already declared in commits (fold into the phase record)

- **Both task docs carried stale counters.** `Task-6a-3.md` pins `IpcChannel`
  87 / `MIGRATIONS.length` 19; `Task-6a-4.md` pins 92 / 19 / `sqliteTable(` 18.
  Actual at close: **97 / 20 / 19**. Cause: the day-report feature (D152/D153)
  landed between the 6a docs being authored at `47f633c` and the tasks running.
  This is G6 firing exactly as predicted, for the third and fourth time.
- **The F49 acceptance grep was narrowed, and the reason is a conflict between
  two of 6a-4's own requirements.** The doc's command globs `docker*.ts`, which
  matches the test file — and that file must contain `--rm` / `rm -v` /
  `volume rm` in order to assert their absence. Spec §6 also requires UI copy
  telling the user to run `docker volume rm` themselves. Resolution: the
  destruction copy lives with the UI where §6 says it belongs, the refusal
  constants stay shared, and the grep runs over the two implementation files —
  where it is genuinely clean, so any future hit is a real finding.
- **Two acceptance items were NOT driven and were not claimed:** indexing into
  the provisioned database (the drive's project is not a git repository, so the
  indexer honestly refused; schema-apply and a live query did work), and the
  "Docker is not available" refusal (driving it live means stopping Docker
  Desktop and killing `chorus-g2-neo4j`; unit-tested only).
- **Two UI bugs were found by CLICKING, not reading** — a container removed
  outside Chorus left the user with no way back (fixed with "Create it again"),
  and the state line claimed *"removed outside Chorus"* after Chorus itself
  removed it (docker reports absence, never a cause; now "no longer exists").
  Worth recording as the phase's G2 lesson: the wire-level drive passed both.

---

## What the pass should leave behind

1. Phase 6a marked **COMPLETE** with its four landings, gate tally and milestone.
2. **D154** recorded, plus the Phase 5 scope rulings.
3. **F77** and **F78** written up.
4. §4's council mechanism corrected; its four obligations preserved.
5. §5 Verified Ground Facts re-measured, superseded rows kept beneath (the log
   accumulates, never gets rewritten).
6. The "How to run the next step" block pointing at **Phase 5's D4 pass**, with
   a baseline that was measured today.
7. Phase 5's entry revised for the v1 scope, the Fleet Switcher split, the
   `usage_records` correction, and the CR gate's new venue.

**Do not start Phase 5 in this session.** The pass ends with the roadmap true;
`/phase-kickoff` is a separate step, and its first act is a D4 pass whose
`uiohook-napi` prebuild probe is marked *"do this first"*.

---

## Verification for the pass itself

```
npm run typecheck          # 0
npx vitest run             # 2230 / 2230, 66 files
npm run grep:secrets       # clean
```

A documentation pass changes no code, so these should be unchanged — run them
anyway to prove the tree you measured is the tree you described.

**And audit your own citations semantically, in node, rather than by grep.** A
previous pass produced false greens because a perl byte-mode check missed
en-dash ranges and a backtick inside a grep ERE meant start-of-buffer.

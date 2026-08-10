# Task 8-0 — Execution Prompt (paste into a fresh session)

> **⚠ REGENERATED 2026-08-10 against `main` at `2bc5d7f`. The previous version of this file was
> written on 2026-08-08 and is stale in seven ways — it named a worktree that has since been
> deleted, a branch that no longer exists, a migration hold that has been discharged, an empty
> `node_modules` that has been restored, uncommitted task docs that are now committed, a baseline
> of 15 migrations, and line numbers that the v17 agent-lock work moved. Everything below was
> re-measured this pass. Do not consult the old version; git history has it if you need it.**

---

You are the **Coordinator** for **Task 8-0 — Turn Boundary Capture**, the continuation of Mission
Control's spec-Phase-0 telemetry capture in the Chorus repo.

**Repo root:** `C:\Projects\ContactEstablished\Chorus` (the main checkout — `main` is checked out
there, and the worktree the old prompt named was deleted on 2026-08-10)
**Expected branch:** `main` at `2bc5d7f`, or a fresh branch off it — confirm with
`git branch --show-current` and `git log --oneline -1`. **Do not switch branches without
instruction.** If Matthew has given you a worktree, use that instead and say so in your report.

---

## ⚠ GATE 0 — THE MIGRATION NUMBER. DISCHARGED, BUT STILL COMPUTE IT YOURSELF.

**The block is gone.** This task was held because Phase 6 had `v16` reserved and its number had
already decayed twice while it waited. **Phase 6's Task 6-4 landed and `v16` is spent; the v17
agent-lock work then took `v17`.**

Measured 2026-08-10 at `2bc5d7f`: **`MIGRATIONS.length` is 17**, highest version comment `v17`,
so **the next free number is `v18`**.

**You must still compute it rather than copy it from this line.** That is gate **G6**, added to the
roadmap on 2026-08-10 after this exact class of mistake was measured **seven times** across three
different counters — and the migration instance is the one that drew blood. `storage.ts` records it
in its own words at the `v17` comment block: the agent-lock branch and Phase 6 both claimed `v16`,
so one migration was **skipped in silence**, `schema_migrations` said 16, the column did not exist,
and the first read threw `no such column` out of `getSessionsForProject` **during boot restore** —
a runtime failure that pointed at a query rather than at a migration.

**Run this first:**

```bash
git fetch origin && git log --oneline -3 origin/main
node -e "const s=require('fs').readFileSync('src/main/services/storage.ts','utf8');const i=s.indexOf('const MIGRATIONS: string[] = [');const b=s.slice(i,i+s.slice(i).indexOf('\n]'));console.log('MIGRATIONS.length =',(b.match(/^  \`/gm)||[]).length)"
```

| What you find | What you do |
|---|---|
| `MIGRATIONS.length` is **17** | Proceed. Your version is **`v18`**. Assert it in code as the other migrations do. |
| It is **more than 17** | Another branch landed one while you were reading. **Recompute; take `MIGRATIONS.length + 1`.** This is normal, not an error. |
| It is **less than 17** | **STOP and ask.** Your checkout is behind or something was reverted. Never leave a gap — it breaks the `applied + 1 … MIGRATIONS.length` loop at `storage.ts:2963`. |

**Also check `main`'s highest version, not only this file's length** (G6). A sibling branch can claim
a number you cannot see, and nothing in this repo will tell you until a column goes missing at
runtime.

---

## ⚠ GATE 1 — ENVIRONMENT. RESTORED 2026-08-10, BUT VERIFY, AND KNOW HOW IT BREAKS.

`node_modules` **is installed** as of 2026-08-10: 341 packages in the main checkout, with
`better-sqlite3` rebuilt for the Electron ABI (`build/Release/better_sqlite3.node`, ~1.9 MB).

**⚠ IT IS ONE SHARED DIRECTORY, NOT ONE PER WORKTREE.** Every `.chorus` worktree **junctions into
`C:\Projects\ContactEstablished\Chorus\node_modules`**. Emptying that single directory removes
typecheck and vitest from every worktree at once — which happened mid-session on 2026-08-09.

If it is missing or empty, restore it from the **main checkout**:

```bash
npm ci                          # not `npm install` — ci installs the lockfile exactly, no churn
npm run rebuild:better-sqlite3  # the /Od workaround; .npmrc documents why
```

`.npmrc` explains the rebuild: better-sqlite3 12.11.1 has no `electron-v148` prebuild on npm, so it
source-builds and MSVC 17.14 ICEs (C1001) on `sqlite3.c` at default optimization. `node-pty` needs
no rebuild — its N-API prebuilds ship in-package.

**⚠ AND WATCH FOR THE FALSE GREEN THIS PRODUCES.** With the toolchain gone, `npm run typecheck`
fails with `'tsc' is not recognized` — which contains no `error TS`, so a grep for the compiler's
error string reports a clean pass. **Check the exit code, and grep for the toolchain's own failure,
not only for `error TS`.**

**Baseline measured 2026-08-10 at `2bc5d7f` — write your own down before touching code:**

| Gate | Value |
|---|---|
| `npm run typecheck` | **exit 0**, node + web |
| `npx vitest run` | **1757 passed / 1757, across 50 files**, exit 0 |
| `IpcChannel` | **86** (you add none) |
| `MIGRATIONS.length` | **17** |

> Known flake, recorded as **F50**: `src/main/adapters/adapters.test.ts` fails intermittently in
> full-suite runs (observed once in nine) while passing 5/5 in isolation — cross-file interference,
> pre-existing, not yours. **Re-run before diagnosing a count change.**

---

## ⚠ GATE 2 — THE TREE IS CLEAN. IT WAS NOT WHEN THIS TASK WAS WRITTEN.

The old prompt warned about thirteen uncommitted files. **They are all committed now** — the Fleet
Switcher rename and the Mission Control audit landed as `02abd95` on 2026-08-10, including this
task's own three documents, and the `attentionCore.test.ts` one-liner has since been typechecked and
is green.

Run `git status --porcelain` yourself. **Expect it to be clean.** If it is not, list what you found
in your report and **do not revert, stage, or commit anything you did not create** — in particular
anything under `_verify/`, which is gitignored working evidence.

---

## Goal

Persist the **boundaries of agent turns** so Mission Control's estimator has a unit of work with a
real start and a real end.

The finding driving this (roadmap **F52**, measured over 172 real dispatches): **a `dispatch` is not
a unit of work.** It is one PTY lifetime, and an interactive agent pane has no natural completion
event — so **5 of 172 dispatches ever reached `completed`**, closed ones average 74–134 minutes with
a maximum of 557, and `ended_at - started_at` measures how long a terminal was open.
`classifyOutcome` (`src/main/services/dispatches.ts:33`) is **correct**; there is no bug to fix. The
fix is a new granularity.

The right unit already arrives and is discarded: `src/main/services/agentEvents.ts` receives Claude
Code's lifecycle hooks, classifies them to `working` / `needs-you`, and holds the result in an
**in-memory `Map`** for the filmstrip lights. A `needs-you → working` edge is `UserPromptSubmit`;
`working → needs-you` is `Stop`. **That pair is one turn.** Nothing persists it, and **it cannot be
backfilled** — every day this waits is calibration permanently lost.

---

## Ground yourself first — read before editing

**Specification (authoritative, read both in full):**
- `docs/Features/Foundation/Tasks/Task-8-0.md` — scope, non-goals, acceptance criteria.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-8-0.md` — exact DDL, pure-core
  signatures, the behaviour table, the wiring points.

Where they disagree: **the task doc wins on *what*, the spec wins on *how*.**

**Roadmap context** — `docs/Features/Foundation/roadmap.md`:
- **F51** and **F52** (§5) — the audit that produced this task.
- **D133** (§6) — the ruling, including what this task may not do. *(Renumbered from D132 on
  2026-08-10; if you find a stale `D132` reference to the Mission Control audit anywhere, it means
  D133.)*
- **D129** and **D130** (§6) — the hook listener's design and security model. **D130 is a constraint
  you must not breach.**
- **G6** (§6 Gates) — re-count shared counters after merging.
- **D55** — no number ships without its denominator.
- Phase 8 entry (§7) — placement, and the note recording that spec Phase 0 is not actually done.

**Code to inspect — line numbers re-verified 2026-08-10 at `2bc5d7f`. They have now shifted twice;
re-confirm before quoting them.**

| File | Line | Why |
|---|---|---|
| `src/main/services/dispatches.ts` | `33` (`classifyOutcome`), `75`/`100` (the `safely(...)` wrapper in use) | **The template.** Your recorder is this file's shape: open on an announcement, close on an announcement, heal orphans at boot, swallow every write error. |
| `src/main/services/agentEvents.ts` | `169` (the edge-trigger early return), `138` + `319` (`onActivity` interface and implementation) | The event source. **Read `169` carefully** — `if (activity.get(sessionId)?.activity === next) return` is why the core is a two-state machine and why a tool-call count is unobservable. |
| `src/main/services/agentEventsCore.ts` | `101` (`classifyHookEvent`) | The classification you consume. **Do not modify.** |
| `src/main/services/attention.ts` | `315` (`dispatchId: null`) | The read-time-join precedent your schema must follow. |
| `src/main/db/schema.ts` | `227` (`dispatches` table), `241` (`ended_at` nullable convention) | Column conventions and the no-FK rule. |
| `src/main/services/storage.ts` | `171` (`MIGRATIONS`), `252` (the v7 comment register — match this style), `2963` (the apply loop) | Where the migration goes. |
| `src/main/index.ts` | `9` + `96` (import and module-level handle), `441`–`447` (`createDispatchRecorder`, `healOrphansAtBoot`, `attach`), `90` + `345`–`346` (`agentEvents` construction and binding) | The wiring points, each beside an existing one. |
| `src/main/services/dispatches.test.ts` | whole file | The fake-storage test pattern to copy. |

---

## Implementation scope

Exactly the files in Task-8-0.md's **Exact Scope** table:

- **Create** `src/main/services/turnsCore.ts` + `turnsCore.test.ts` — the pure core. No `electron`,
  no `better-sqlite3`, no `Date.now()`. `vitest.config.ts` makes this mandatory: tests never import
  `storage.ts` or the native binding, which is built for the Electron ABI while Vitest runs under
  Node.
- **Create** `src/main/services/turns.ts` + `turns.test.ts` — the seam.
- **Edit** `src/main/db/schema.ts` — the `agentTurns` table.
- **Edit** `src/main/services/storage.ts` — the migration (Gate 0) and five accessors.
- **Edit** `src/main/index.ts` — the wiring points.

**Nothing else.** No IPC channel, no preload forwarder, no renderer file, no npm dependency, no UI.
`IpcChannel` stays at **86**.

### Resolved decisions you are bound by

- **D130 (ACCEPTED 2026-08-07):** *"only `hook_event_name` is read — no prompt text, no transcript
  path, no tool input is extracted, stored or logged, because what is not taken cannot leak."*
  **Your task consumes the already-classified `onActivity` callback and stamps its own timestamp. It
  parses no hook body and stores no content of any kind.**
- **D129 (ACCEPTED 2026-08-07):** *"an agent with no hook bus (codex, kimi, opencode) keeps exactly
  three states."* **You may not invent, interpolate or PTY-derive turns for hookless agents.** They
  produce zero rows, and you prove it.
- **D133 (ACCEPTED 2026-08-08):** this task is authored and held; the merge script is separate;
  project ids are preserved, not reconciled.
- **G6 (2026-08-10):** re-count `MIGRATIONS.length` after merging; never add your delta to what the
  file said when you branched.
- **D16 resolution (d):** pane close deletes the sessions row, so **no `REFERENCES` clause** — FKs
  are enforced (**F16**).
- **D55:** the coverage figure must be computable from the rows alone. The spec's §2 SQL is the
  artifact; run it and keep the output.

---

## Strict non-goals

- No board, dispatch panel, seed loader, readiness/critical-path/float, Monte Carlo, ship-date card,
  PM report, or pane task chip.
- **No edit to `agentEvents.ts` or `agentEventsCore.ts`.** They must be byte-identical to HEAD when
  you finish. If a turn cannot be derived without changing them, **raise it and stop**.
- **No tool-call count.** It is unobservable from `onActivity` because `record()` is edge-triggered
  (`agentEvents.ts:169`). Record it as a finding; do not smuggle it in by touching the hook path.
- No writes to `dispatches` or `attention_spans`. No `dispatch_id` or `task_id` column.
- No backfill from transcripts, ring buffers, or `~/.claude/projects` JSONL. History before your
  commit does not exist.
- No network call in the new modules. No per-turn logging beyond one boot line.
- Do not revert, stage, or commit unrelated or untracked files, including anything under `_verify/`.
- Do not push or open a PR unless explicitly asked.

---

## Required workflow

1. **Gates 0, 1, 2 first.** Report `BLOCKED` immediately if Gate 0 says stop.
2. Read both task docs in full and the roadmap decisions listed above.
3. Implement as a **coordinator**: worker pass → review the result against
   `ImplementationSpec-8-0.md` clause by clause → a code-quality pass → resolve findings →
   verification → commit narration.
4. **One intentional commit (G3)**, in the repo's house style: a concise title, then a plain-language
   description a non-technical reader can follow first, technical detail second under a
   `--- technical ---` divider. **The commit message must name the migration version actually used**
   and state that it was computed from `MIGRATIONS.length + 1`, not copied from this prompt.
5. If any instruction here conflicts with `CLAUDE.md`, **`CLAUDE.md` wins** — say so in your report.

---

## Verification — run these, do not reason about them

```bash
npm run typecheck          # must exit 0 — check the EXIT CODE, not just for "error TS"
npx vitest run             # must pass; new files included; count >= 1757
npm run grep:secrets       # must be clean
git diff --stat            # scope check: only the files listed above
git diff --exit-code src/main/services/agentEvents.ts src/main/services/agentEventsCore.ts   # must exit 0
```

**Runtime gates — run the app, do not just compile it (G2).**

Migration: apply to the **real dev DB** through the full three-dump protocol (pre / post /
post-restart), keeping dumps under `_verify/8-0/`.

> **⚠ WHICH DATABASE FILE IS THE TRAP THAT SCATTERED THIS DATA IN THE FIRST PLACE (F51).** The dev
> instance normally writes `%APPDATA%\chorus\chorus.db` — **but if you launch it from inside the
> Claude desktop app, Windows app-container redirection sends it to
> `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db` instead.** The
> installed app is `%APPDATA%\chorus-app`. Confirm which file is actually growing before reading it:
>
> ```powershell
> Get-ChildItem "$env:APPDATA","$env:LOCALAPPDATA" -Recurse -Filter "chorus.db*" -EA 0 |
>   Select-Object FullName, Length, LastWriteTime | Sort-Object LastWriteTime -Descending | Select-Object -First 6
> ```
>
> Copy the `.db` **plus its `-wal` and `-shm`** before opening, or recent rows are invisible. Read
> with Python's `sqlite3` (`better-sqlite3` is built for the Electron ABI and will not load under
> plain Node).
>
> **Prefer an isolated instance over Matthew's running app.** `npm run build`, copy the DB **and
> `Local State`** into a scratch dir, then launch
> `node_modules\electron\dist\electron.exe . --remote-debugging-port=9223 --user-data-dir=<scratch>`
> from the repo root and drive it over CDP. Chorus has no single-instance lock, so this just works,
> and every write lands in the copy.
>
> **Never kill Chorus by process name.** The installed `Chorus.exe` is Matthew's real instance.
> Target the dev one by command line:
> ```powershell
> Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
>   Where-Object { $_.CommandLine -like '*9223*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
> ```

Then drive, and record what you actually observed:

1. **One turn** — launch a `claude` session, send one prompt, wait for the amber `Stop`. Expect
   exactly one row, `outcome='completed'`, `closed_by='stop'`, duration matching the observed turn
   within 1 s.
2. **Two turns** — a second prompt in the same session yields a second row. Proves per-turn, not
   per-session.
3. **No hook bus** — a `codex` session produces **zero** rows. Show the query returning 0.
4. **Mid-turn kill** — kill the pane mid-turn → row closes `abandoned/session-exit`. Then tree-kill
   the app mid-turn → next boot heals to `abandoned/boot-heal` with `ended_at` NULL.
5. **Coverage query** — run the spec's §2 SQL against the real DB; keep the output. This is
   acceptance criterion 7.
6. **Falsification** — temporarily invert `actionForTransition`'s `needs-you` branch to `none`,
   confirm turns never close, revert, and **prove the revert against the commit diff**.

---

## Failure honesty

If a verification command fails for an unrelated environment reason, **capture the exact output,
explain it, and do not claim success.** A gate you could not run is reported as *not run* — never as
passed, never silently omitted.

**Two specific false-green traps this repo has already produced, both real:**
- A missing toolchain makes `npm run typecheck` fail with `'tsc' is not recognized`, which contains
  no `error TS`. **Check exit codes.**
- A passing unit test says nothing about runtime behaviour. **Do not infer a passing runtime result
  from a passing suite.**

If the runtime gates cannot be driven (no hook bus available, app will not launch, migration will
not apply), report `DONE_WITH_CONCERNS` or `BLOCKED` with the evidence.

---

## Final report — required structure

1. **Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
2. **Migration version used**, and the `MIGRATIONS.length + 1` computation that produced it.
3. **Files changed**, with a one-line reason each.
4. **Build results:** typecheck exit code, vitest counts **before and after** (baseline 1757/50),
   secret-grep status.
5. **Runtime results:** what you actually observed for each of the six drives above — real numbers
   and row contents, not "verified".
6. **Review outcomes:** spec-compliance findings and code-quality findings, and how each was
   resolved.
7. **Non-goals confirmation:** explicitly confirm `agentEvents.ts` and `agentEventsCore.ts` are
   byte-identical to HEAD, that no hook body is parsed anywhere in the new code, and that
   `IpcChannel` is still 86.
8. **Residual risks and recorded findings** — anything you found and deliberately did not fix.
9. **Final `git status`** and the commit hash.

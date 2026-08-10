# Task 8-0 — Execution Prompt (paste into a fresh session)

---

You are the **Coordinator** for **Task 8-0 — Turn Boundary Capture**, the continuation of Mission Control's spec-Phase-0 telemetry capture in the Chorus repo.

**Repo root:** `C:\Projects\ContactEstablished\.chorus\Chorus\wt-910e111a` (a git worktree)
**Expected branch:** `chorus/Chorus/910e111a` — confirm with `git branch --show-current`; **do not switch branches without instruction.**

---

## ⚠ GATE 0 — THE MIGRATION NUMBER. DO THIS BEFORE ANYTHING ELSE, AND BE PREPARED TO STOP.

This task adds a table and therefore a migration. **It is blocked behind Phase 6 (Neo4j), which has already reserved the next free version.**

Facts as of **2026-08-08**, verified against `main` at commit `fd41f98`:

- `MIGRATIONS.length` is **15** (`src/main/services/storage.ts:171`).
- **Task 6-3 has `v16` booked.** The roadmap's Phase 6 entry says verbatim: *"The next free version is `v16` and the assertion is `MIGRATIONS.length + 1 === 16`."*
- Therefore **Task 8-0 is NOT v16.** It takes the next free number after Phase 6 lands — **expected to be v17, and you must not assume v17.**

Phase 6's own entry records that its pinned number **decayed twice** (12→13, then 13→15) while it sat queued. That is precisely why no number is written into this task's docs.

**Run this first:**

```bash
git fetch origin && git log --oneline -3 origin/main
grep -n "const MIGRATIONS" src/main/services/storage.ts
node -e "const s=require('fs').readFileSync('src/main/services/storage.ts','utf8');const i=s.indexOf('const MIGRATIONS');console.log('backtick-started entries:',(s.slice(i).match(/^  `/gm)||[]).length)"
```

**Decision rule — no judgement calls:**

| What you find | What you do |
|---|---|
| Phase 6 / Task 6-3 has **not** landed its migration (`MIGRATIONS.length` still 15) | **STOP. Report `BLOCKED`.** Do not claim v16. Do not "just take v17 and leave a gap" — a gap breaks the `applied + 1 … MIGRATIONS.length` loop at `storage.ts:2634`. |
| Task 6-3 **has** landed (`MIGRATIONS.length` is 16 or more) | Proceed. Your version is `MIGRATIONS.length + 1`, computed **at the moment you write it**. Assert it in the code as the other migrations do. |
| Anything ambiguous | **STOP and ask.** Racing a migration number is a defect, not a shortcut. |

---

## ⚠ GATE 1 — THE ENVIRONMENT IS NOT READY OUT OF THE BOX

**`node_modules` is an EMPTY DIRECTORY in this worktree and in the main checkout.** Nothing is installed. `npm run typecheck`, `npx vitest run` and `npm run grep:secrets` **cannot run** until you fix this. A previous session could not execute any gate for exactly this reason — do not repeat that.

```bash
npm install
```

**If `better-sqlite3` fails to build:** `.npmrc` documents the cause — 12.11.1 has no `electron-v148` prebuild on npm, so it falls back to a source build and MSVC 17.14 ICEs (C1001) on `sqlite3.c` at default optimization. The fix is in `package.json`:

```bash
npm run rebuild:better-sqlite3
```

`node-pty` needs no rebuild — its N-API prebuilds ship in-package.

Establish and **write down** the baseline before touching code: typecheck exit code, the exact vitest pass count, and secret-grep status. Every later claim is measured against these numbers, not against any number quoted in a doc.

> Known flake, recorded as **F50**: `src/main/adapters/adapters.test.ts` fails intermittently in full-suite runs (observed once in nine) while passing 5/5 in isolation — cross-file interference, pre-existing, not yours. Re-run before diagnosing a count change.

---

## ⚠ GATE 2 — THE TASK DOCS ARE UNCOMMITTED, AND THE BRANCH IS BEHIND

`git status --porcelain` at hand-off showed these **pre-existing** changes on `chorus/Chorus/910e111a`:

```
 M _ui/main-workspace.html
 M docs/Features/Foundation/roadmap.md
 M docs/Plan.md
 M "docs/design/Chorus Micro Surfaces.dc.html"
 M "docs/design/Chorus Overview.dc.html"
 M "docs/design/Chorus Workspace.dc.html"
 M "docs/design/v2/Chorus Micro Surfaces.dc.html"
 M "docs/design/v2/Chorus Overview.dc.html"
 M "docs/design/v2/Chorus Workspace.dc.html"
 M src/main/services/attentionCore.test.ts
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-8-0.md
?? docs/Features/Foundation/Tasks/Task-8-0.md
?? docs/Features/Foundation/Tasks/Task-8-0-ExecutionPrompt.md
```

These are the **D132 Fleet Switcher rename** and the **D133 Mission Control audit** — your own task's specification is among them. **Do not revert, discard, or stash them.** They may already be committed by the time you start; check first.

The branch was **one commit behind `main`** (`fd41f98`, "The Phase 6 memory plans now say what was actually decided") and had nothing `main` lacked. Bring it up to date before starting, and expect Phase 6 work to have landed on `main` in the meantime — that is the event Gate 0 is waiting on.

`src/main/services/attentionCore.test.ts` carries a one-line change (`'mission-control'` → `'fleet-switcher'` in the D70 future-view fixture, `attentionCore.test.ts:214`) that has **never been typechecked**, because of Gate 1. Verify it as part of your baseline; it should be inert.

---

## Goal

Persist the **boundaries of agent turns** so Mission Control's estimator has a unit of work with a real start and a real end.

The finding driving this (roadmap **F52**, measured over 172 real dispatches): **a `dispatch` is not a unit of work.** It is one PTY lifetime, and an interactive agent pane has no natural completion event — so **5 of 172 dispatches ever reached `completed`**, closed ones average 74–134 minutes with a maximum of 557, and `ended_at - started_at` measures how long a terminal was open. `classifyOutcome` (`src/main/services/dispatches.ts:33`) is **correct**; there is no bug to fix. The fix is a new granularity.

The right unit already arrives and is discarded: `src/main/services/agentEvents.ts` receives Claude Code's lifecycle hooks and classifies them to `working` / `needs-you`, holding the result in an **in-memory `Map`** for the filmstrip lights. A `needs-you → working` edge is `UserPromptSubmit`; `working → needs-you` is `Stop`. **That pair is one turn.** Nothing persists it, and it cannot be backfilled.

---

## Ground yourself first — read before editing

**Specification (authoritative, read both in full):**
- `docs/Features/Foundation/Tasks/Task-8-0.md` — scope, non-goals, acceptance criteria.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-8-0.md` — exact DDL, the pure-core signatures, the behaviour table, the wiring points.

Where they disagree: **the task doc wins on *what*, the spec wins on *how*.**

**Roadmap context** — `docs/Features/Foundation/roadmap.md`:
- **F51** and **F52** (§5 Verified Ground Facts) — the audit that produced this task.
- **D133** (§6) — the ruling, including what this task may not do.
- **D129** and **D130** (§6) — the hook listener's design and its security model. **D130 is a constraint you must not breach.**
- **D55** — no number ships without its denominator.
- Phase 8 entry (§7) — placement.

**Code to inspect, with current line numbers (verified 2026-08-08 at `842a7cc`; re-confirm, they shift):**

| File | Lines | Why |
|---|---|---|
| `src/main/services/dispatches.ts` | `33` (`classifyOutcome`), `165` (`safely`) | **The template.** Your recorder is this file's shape: open on an announcement, close on an announcement, heal orphans at boot, swallow every write error. |
| `src/main/services/agentEvents.ts` | `109` (edge-trigger early return), `117` (listener guard), `159` (respond-before-derive) | The event source. **Read `109` carefully** — it is why the core is a two-state machine. |
| `src/main/services/agentEventsCore.ts` | `101` (`classifyHookEvent`) | The classification you consume. **Do not modify.** |
| `src/main/services/attention.ts` | `312-315` (`dispatchId: null`) | The read-time-join precedent your schema must follow. |
| `src/main/db/schema.ts` | `228` (`ended_at` NULL convention), `215`+ (`dispatches`) | Column conventions and the no-FK rule. |
| `src/main/services/storage.ts` | `171` (`MIGRATIONS`), `252` (v7 comment register), `2634` (the apply loop) | Where the migration goes and the comment style to match. |
| `src/main/index.ts` | `89`, `334-335`, `398`, `403`, `624`, `640` | The four wiring points, each beside an existing one. |
| `src/main/services/dispatches.test.ts` | whole file | The fake-storage test pattern to copy. |

---

## Implementation scope

Exactly the files in Task-8-0.md's **Exact Scope** table:

- **Create** `src/main/services/turnsCore.ts` + `turnsCore.test.ts` — the pure core. No `electron`, no `better-sqlite3`, no `Date.now()`. `vitest.config.ts` makes this mandatory: tests never import `storage.ts` or the native binding, which is built for the Electron ABI while Vitest runs under Node.
- **Create** `src/main/services/turns.ts` + `turns.test.ts` — the seam.
- **Edit** `src/main/db/schema.ts` — the `agentTurns` table.
- **Edit** `src/main/services/storage.ts` — the migration (see Gate 0) and five accessors.
- **Edit** `src/main/index.ts` — four wiring points.

**Nothing else.** No IPC channel, no preload forwarder, no renderer file, no npm dependency, no UI.

### Resolved decisions you are bound by

- **D130 (ACCEPTED 2026-08-07):** *"only `hook_event_name` is read — no prompt text, no transcript path, no tool input is extracted, stored or logged, because what is not taken cannot leak."* **Your task consumes the already-classified `onActivity` callback and stamps its own timestamp. It parses no hook body and stores no content of any kind.**
- **D129 (ACCEPTED 2026-08-07):** *"an agent with no hook bus (codex, kimi, opencode) keeps exactly three states."* **You may not invent, interpolate or PTY-derive turns for hookless agents.** They produce zero rows, and you prove it.
- **D133 (ACCEPTED 2026-08-08):** this task is authored and held; the merge script is separate; project ids are preserved, not reconciled.
- **D16 resolution (d):** pane close deletes the sessions row, so **no `REFERENCES` clause** — FKs are enforced (**F16**).
- **D55:** the coverage figure must be computable from the rows alone. The spec's §2 SQL is the artifact; run it and keep the output.

---

## Strict non-goals

- No board, dispatch panel, seed loader, readiness/critical-path/float, Monte Carlo, ship-date card, PM report, or pane task chip.
- **No edit to `agentEvents.ts` or `agentEventsCore.ts`.** They must be byte-identical to HEAD when you finish. If a turn cannot be derived without changing them, **raise it and stop**.
- **No tool-call count.** It is unobservable from `onActivity` because `record()` is edge-triggered. Record it as a finding; do not smuggle it in by touching the hook path.
- No writes to `dispatches` or `attention_spans`. No `dispatch_id` or `task_id` column.
- No backfill from transcripts, ring buffers, or `~/.claude/projects` JSONL. History before your commit does not exist.
- No network call in the new modules. No per-turn logging beyond one boot line.
- Do not fix the recorded-but-open `LayoutRenderer` `@focus` gap.
- Do not revert, stage, or commit unrelated or untracked files, including anything under `_verify/` and `docs/` beyond your own task's docs.
- Do not push or open a PR unless explicitly asked.

---

## Required workflow

1. **Gates 0, 1, 2 first.** Report `BLOCKED` immediately if Gate 0 says stop.
2. Read both task docs in full and the roadmap decisions listed above.
3. Implement as a **coordinator**: worker pass → review the result against `ImplementationSpec-8-0.md` clause by clause → a code-quality pass → resolve findings → verification → commit narration.
4. **One intentional commit (G3)**, narrated in the repo's house style: a concise title, then a plain-language description a non-technical reader can follow, technical detail second. **The commit message must name the migration version actually used** and state that it was computed from `MIGRATIONS.length + 1`, not copied.
5. If any instruction here conflicts with `CLAUDE.md`, **`CLAUDE.md` wins** — say so in your report.

---

## Verification — run these, do not reason about them

```bash
npm run typecheck          # must exit 0
npx vitest run             # must pass; new files included; count >= baseline
npm run grep:secrets       # must be clean
git diff --stat            # scope check: only the files listed above
git diff --exit-code src/main/services/agentEvents.ts src/main/services/agentEventsCore.ts   # must exit 0
```

**Runtime gates — run the app, do not just compile it.**

Migration: apply to the **real dev DB** through the full three-dump protocol (pre / post / post-restart), keeping dumps under `_verify/8-0/`.

> **⚠ WHICH DATABASE FILE IS THE TRAP THAT SCATTERED THIS DATA IN THE FIRST PLACE (F51).** The dev instance normally writes `%APPDATA%\chorus\chorus.db` — **but if you launch it from inside the Claude desktop app, Windows app-container redirection sends it to `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db` instead.** Confirm which file is actually growing before reading it:
>
> ```powershell
> Get-ChildItem "$env:APPDATA","$env:LOCALAPPDATA" -Recurse -Filter "chorus.db*" -EA 0 |
>   Select-Object FullName, Length, LastWriteTime | Sort-Object LastWriteTime -Descending | Select-Object -First 6
> ```
>
> Copy the `.db` **plus its `-wal` and `-shm`** before opening, or recent rows are invisible. Read with Python's `sqlite3` (`better-sqlite3` is built for the Electron ABI and will not load under plain Node).
>
> **Never kill Chorus by process name.** The installed app (`Chorus.exe`) is Matthew's real instance. Target the dev one by command line:
> ```powershell
> Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
>   Where-Object { $_.CommandLine -like '*9222*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
> ```

Then drive, and record what you actually observed:

1. **One turn** — launch a `claude` session, send one prompt, wait for the amber `Stop`. Expect exactly one row, `outcome='completed'`, `closed_by='stop'`, duration matching the observed turn within 1 s.
2. **Two turns** — a second prompt in the same session yields a second row. Proves per-turn, not per-session.
3. **No hook bus** — a `codex` session produces **zero** rows. Show the query returning 0.
4. **Mid-turn kill** — kill the pane mid-turn → row closes `abandoned/session-exit`. Then tree-kill the app mid-turn → next boot heals to `abandoned/boot-heal` with `ended_at` NULL.
5. **Coverage query** — run the spec's §2 SQL against the real DB; keep the output. This is acceptance criterion 7.
6. **Falsification** — temporarily invert `actionForTransition`'s `needs-you` branch to `none`, confirm turns never close, revert, and **prove the revert against the commit diff**.

---

## Failure honesty

If a verification command fails for an unrelated environment reason, **capture the exact output, explain it, and do not claim success.** A gate you could not run is reported as *not run* — never as passed, never silently omitted. The prior session's honest report that `node_modules` was empty and G1/G2 therefore could not execute is the standard here.

If the runtime gates cannot be driven (no hook bus available, app will not launch, migration will not apply), report `DONE_WITH_CONCERNS` or `BLOCKED` with the evidence. **Do not infer a passing runtime result from a passing unit test.**

---

## Final report — required structure

1. **Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
2. **Migration version used**, and the `MIGRATIONS.length + 1` computation that produced it.
3. **Files changed**, with a one-line reason each.
4. **Build results:** typecheck exit code, vitest counts **before and after**, secret-grep status.
5. **Runtime results:** what you actually observed for each of the six drives above — real numbers and row contents, not "verified".
6. **Review outcomes:** spec-compliance findings and code-quality findings, and how each was resolved.
7. **Non-goals confirmation:** explicitly confirm `agentEvents.ts` and `agentEventsCore.ts` are byte-identical to HEAD, and that no hook body is parsed anywhere in the new code.
8. **Residual risks and recorded findings** — anything you found and deliberately did not fix.
9. **Final `git status`** and the commit hash.

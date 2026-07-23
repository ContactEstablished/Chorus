# Chorus Phase 3, Task 3-5 Execution Prompt — PTY Scrubber on Ingest

_Generated 2026-07-23 against HEAD `899df07`. Every ground fact in §3–§4 was verified at that commit by direct coordinator inspection: `npm run typecheck` exits 0, `npx vitest run` = **235/235 across 11 files**, `npm run grep:secrets` clean, the ingest point at `sessionManager.ts:297–303` byte-identical to the spec's description, and the working tree carrying **docs-only** changes plus two untracked review artifacts (§5)._

## §1 Role

You are the implementation engineer for Chorus **Phase 3, Task 3-5** — the phase's fifth task, created by **D35**. Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; **do not switch or create branches**. Expected HEAD: `899df07` ("Task 3-4: First real Settings view") or a descendant.

Planning was done by a separate coordinator. Your final summary will be reviewed against the task docs, and **the reviewer WILL re-run your verification independently** — including the split-across-chunks runtime proof.

**⚠ THIS SESSION MAKES EXACTLY ONE COMMIT (G3).** The D32/D36/D37 two-commit sessions were each individually ratified; no chore is pending for this one. Three files: the pure scrubber, its tests, and the `SessionManager` wiring.

**⚠ THIS TASK SHIPS WITH ZERO REGISTERED SECRETS.** It is the 3-1 pattern one layer down: the redaction machinery lands **before** the secret it protects against exists, so Task 3-6's injected keys arrive into a scrubber already proven against planted fakes. The registration seam you build has **zero callers in your commit** — 3-6 is its one legal caller. Your runtime proof therefore uses **temporary, declared, reverted instrumentation** (§10) — the Task 2-4 precedent, checked against the commit diff.

## §2 Goal

Make Chorus's own stored and replayed terminal output safe against an agent that prints its injected key.

The council's reasoning (CR-3.0, majority 2-of-3, ratified as **D33 Q4**): an agent is an autonomous program with shell access — `echo $env:ANTHROPIC_API_KEY`, a debug flag, a crash dump, or a provider error page can all put a key into the PTY stream. Chorus does not control the agent. Chorus **does** control the ring buffer, the renderer replay, and Phase 7's future transcripts — those are Chorus-controlled surfaces, and storing or replaying a key there is Chorus's leak, not the agent's.

**This is exact-value matching, not pattern matching — the distinction IS the design:**

- `logger.ts` scrubs by **shape** (`sk-ant-…`), because it cannot know which secrets exist and must catch any of them in free text.
- This scrubber scrubs by **value**, because it knows precisely which strings were injected into this session. Zero false positives, by construction. A shape-based scrubber on a terminal stream would mangle legitimate agent output — a code review of a file containing an example key, a `git diff` of `.env.example`, documentation — for no security gain. **Do not "improve" this by applying `secret-patterns.json` to the PTY stream.** That would be a different, worse feature.

**What this task honestly does not do** — stated in code comments and your summary, in the council's own words: the raw chunk transiently exists in main memory before scrubbing (node-pty delivers it there — the contract phrases this as *reducing retention and preventing storage/replay/transcript exposure*, never as preventing transient heap presence); an agent that base64-encodes, ANSI-interleaves, or split-writes the key with other content between **defeats exact matching, out of scope by ruling**; scrubbing mutates user-visible terminal output. Qwen's accept-and-document dissent is preserved in D33 precisely so nobody later claims more than this — acknowledge it in the commit message or a code comment.

## §3 Project Context

Architecture: local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia; agent CLIs as live TUIs in xterm.js panes; PTYs (node-pty / ConPTY) in MAIN owned by `SessionManager`; renderer attaches by session id over typed IPC. Phase 3 so far: 3-1 redacting logger · 3-2 DPAPI vault (write-only IPC) · 3-3 `AgentAdapter` refactor · 3-4 Settings view. **This task touches none of their surfaces except `SessionManager`'s ingest.**

Dev machine: Windows 11, PowerShell 7, Node 22.14.0, git 2.50.0.windows.1. CLIs: `claude.exe` 2.1.218 (self-updated mid-phase; auth state has varied — an auth screen still proves bytes traverse the PTY), `codex-cli` 0.144.6 (npm `.cmd` shim via `cmd.exe /c`). **This task needs bytes flowing through a PTY, not agent intelligence** — typing at whatever prompt an agent shows (even a login screen) is a legitimate way to emit test text; Codex is available if you want a responsive TUI.

Environment quirks — all expected, none a bug you caused:

- **(a)** OS toasts disabled system-wide; `[notify] toast failed:` lines are normal.
- **(b)** Codex TUI first-run prompts — update prompt (press **2 to Skip, never 1**); possible directory-trust prompt; `TERM is set to "dumb"` `[y/N]`.
- **(c)** `node-pty` logs `AttachConsole failed` on PTY teardown. Noise.
- **(d)** The automation harness strips `ComSpec` and modifies PATH — restore before launching:
  `$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"` and
  `$env:PATH = "$((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').Path);$((Get-ItemProperty 'HKCU:\Environment').Path)"`.
- **(e)** `TaskStop` kills only the wrapper shell. Find the root (`node.exe` with `electron-vite*dev` in its command line) and `taskkill /PID <pid> /T /F`; confirm port 9222 free. **electron-vite does NOT hot-restart main on `src/main` edits — this task is entirely main-process, so budget a real tree-kill cold boot for every check, including each instrumentation change.**
- **(f)** Launch: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` from repo root.
- **(g)** Orphan checks walk the electron main PID's **descendant tree**, never `tasklist` name-matching (~16 unrelated `claude.exe` on this machine).
- **(h)** Verification driver: **CDP** on 9222. Two capabilities matter here: `Input.insertText` reaches xterm's `onData` **as one chunk** — useful for controlling exactly how input arrives; and `Runtime.evaluate` reaches `window.chorus` for attach-replay dumps. Wrap evaluates in IIFEs; `ws` in the session scratchpad, never the repo. **Harness note from 3-4:** CDP-driven Vue interactions need a microtask tick between events, or clicks land on stale `:disabled` state.
- **(i)** **`sqlite3` CLI NOT installed** — irrelevant this task (no DB claims beyond "nothing changed"), but the dump-script pattern is `_verify/2-1-dump.js` if needed. **Flake: no output file on first run — retry once.**
- **(j) G4 + `_verify/`:** `scripts/secret-grep.mjs` scans `_verify/`. Your planted fake value will land in logs and dumps there. **Purge those artifacts before the final `npm run grep:secrets`** — and do not "fix" the gate by editing `SCAN_DIRS`; that edit is a reportable regression.

### Dev-machine baseline — coordinator-verified 2026-07-23, do NOT "clean up"

- Migrations **1–5**; `provider_configs` / `credential_profiles` **empty**; projects `985d547b-…` ("Chorus") / `f47ac10b-…` ("Chorus-Second"); two sessions, both `exited`. **This task adds no migration and writes no rows.**
- **`worktrees` fixture:** `9ba9b0da-…`, `detached`, branch `chorus/Chorus/24b5c1fe`, `base_branch ''`. **⚠ Row, directory, and branch are a retained regression fixture — do not remove any of the three.**
- **F20, stated as fact:** execution sessions run with a **redirected AppData but a real `C:\Projects`** (four implementer sessions in a row saw project ids `a43b395d…`/`b684e96e…`). Filesystem/git evidence is trustworthy; DB evidence describes a different DB. **Quote the `projects` table ids in any dump you make.**

## §4 Ground Yourself First (Read BEFORE Editing)

Docs, in this order:

- `CLAUDE.md` — locked rules. **No new dependency.**
- `docs/Features/Foundation/roadmap.md` — §6 **D33** (specifically **clause 7**, **resolution (a)** — the retention carve-out, and **resolution (e)** — the carry bound + timer flush), **D35** (why this is its own task, before injection); §5 **F20** and the Task 3-4 ground-fact entry (its notes 3/4 bind adjacent surfaces, not yours).
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3.0-Vault-Findings.md` — the HIGH finding, the Q4 ruling, **Qwen's preserved dissent**, risks 1 and 5.
- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — phase contract, file-ownership matrix (this task owns three files).
- `docs/Features/Foundation/Tasks/Task-3-5.md` — **THE task contract. Scope, non-goals, the all-split-points test table, acceptance criteria. THIS GOVERNS.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-5.md` — near-final code: **§2 the pure core** (the module-header honesty comment, `createScrubber`, `heldSuffixLength`, the ordering invariant), **§3 the `SessionManager` wiring** (the match-set carve-out comment, the single `emit` helper, the timer, teardown, the registration seam), **§4 which tests catch which wrong implementations**, **§5 verification notes**. Anchored at `fb3201e`; **the ingest point is verified UNCHANGED at `899df07`** (§4 below) — the spec's insertion description holds as written.

### Code state — verified 2026-07-23 at `899df07`; trust this over any older doc line

- Baseline: typecheck 0; **235/235 across 11 files** — `src/shared/ipc.test.ts` (76), `worktrees.test.ts` (30), `layout.test.ts` (26), `adapters.test.ts` (23), `vaultCore.test.ts` (21), `palette/commands.test.ts` (21), `logger.test.ts` (13), `stores/settings.test.ts` (7), `stores/layout.test.ts` (7), `restore.test.ts` (6), `stores/view.test.ts` (5); `grep:secrets` clean.
- **`src/main/services/sessionManager.ts`** (328 lines) — your entire wiring surface:
  - `BUFFER_MAX_CHARS = 4_000_000` at **14**.
  - `interface PtySession` at **31** — gains `scrubber` + `scrubTimer` fields (spec §3.1's carve-out comment goes ON these fields).
  - `launch(agent, cwd, sessionId)` at **80** — gains the `secrets: readonly string[] = []` parameter, **zero callers supplying it** (grep-verified in your summary). The restore path (`restore()` → `this.spawn`) passes nothing — **that is a real gap 3-6 must close** (a restored BYOK session re-spawns without re-resolving its credential); it is already flagged in the docs, do not fix it here.
  - `attach(sessionId)` at **94** → `snapshot()` at **248** — replays `session.buffer`, which is why scrubbing at ingest covers replay for free.
  - `dispose()` at **239** — gains timer cleanup alongside the existing kill loop.
  - `private spawn(...)` at **257** (the 3-3 adapter shape: `getAdapterOrThrow` → `isPtyAdapter` → `buildLaunch` → `pty.spawn`). **The env line and its D5 comment are NOT yours to touch.**
  - **The ingest point, verbatim at 297–303** — byte-identical to the spec's description:
    ```ts
    child.onData((data) => {
      session.buffer += data
      if (session.buffer.length > BUFFER_MAX_CHARS) {
        session.buffer = session.buffer.slice(session.buffer.length - BUFFER_MAX_CHARS)
      }
      for (const listener of this.dataListeners) listener(id, data)
    })
    ```
    Ring-buffer append first, listener broadcast second, both consuming the same `data`. Your rewrite: **the raw `data` is referenced exactly once — as the argument to the scrub — and everything downstream (buffer, listeners, and therefore `session:data`, replay, and future transcripts) sees only scrubbed output**, via ONE `emit` helper so the carry state advances exactly once per chunk (spec §3.2: two scrub calls on the same chunk is a correctness bug, not duplication).
  - `child.onExit` at **305** — gains the flush-before-notify (spec §3.3).
- **There is no `src/main/services/scrubber.ts`** — you create it (+ its test). It imports **neither `electron` nor `node-pty`**, has **no timers** (the timer lives in `SessionManager` — spec §3), and exports `CREDENTIAL_PLACEHOLDER = '[REDACTED-CREDENTIAL]'` (D33 risk 5 — deliberately distinct from the logger's `[redacted]` so a reader can tell which mechanism fired).
- **`src/main/services/secret-patterns.json`** exists and is **deliberately NOT consumed by this task** (§2). Your planted fake value should *match* its `anthropic` pattern though, so the G4 purge discipline is genuinely exercised.
- **3-4 interaction, from its review (finding 6):** the workspace ⇄ settings view switch unmounts all panes while `session:data` keeps streaming in main; returning re-attaches and replays the buffer. **Your non-interference matrix includes one workspace ⇄ settings round trip during live output** — it exercises replay-from-buffer through your scrubbed path with zero extra harness cost.

### Git checks (run first)

```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: docs entries + 2 untracked review artifacts (see §5)
git log --oneline -1        # expect: 899df07 or descendant
git config user.email       # expect: mwilson29072@gmail.com
git worktree list           # expect: main tree + .chorus\Chorus\wt-24b5c1fe
```

## §5 Pre-existing Changes Warning

**The working tree carries docs-only modifications plus untracked review/design artifacts:**

```
 M docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-4.md
 M docs/Features/Foundation/Tasks/Phase-3-Overview.md
 M docs/Features/Foundation/Tasks/Task-3-4.md
 M docs/Features/Foundation/roadmap.md
?? TASK-3-4-REVIEW-FABLE.md
?? docs/Features/Foundation/Tasks/Task-3-4-ExecutionPrompt.md
?? docs/design/
```

Plus this prompt itself. **These may or may not be committed by the time you start** — either way: **do not revert, stage, or commit anything under `docs/`, and do not touch `TASK-3-4-REVIEW-FABLE.md`** (an untracked review artifact awaiting the docs commit). Your one commit contains exactly three source files. If `git status` shows anything else outside `docs/` at session start, **stop and ask**. `_verify/` is gitignored — but see §3(j) about planted values there.

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate.

- **D1/D3/D14** (locked): Zod in main only; sessions live in main; plain-object IPC payloads. This task adds **no IPC surface at all** — `session:data`'s shape is untouched; only its *content* is scrubbed before validation.
- **D33 clause 7** (RESOLVED 2026-07-22, council majority): exact-value scrub **on ingest** — before ring-buffer append, before replay, before any future transcript write; `[REDACTED-CREDENTIAL]`; chunk-boundary carry-over required.
- **D33 resolution (a)** — **the retention carve-out, your most important comment.** Clause 4 says decrypted plaintext "never enters a retained variable"; exact-match scrubbing REQUIRES retaining injected values for the session's lifetime. The carve-out: the match set is **main memory only, never persisted, never logged, never sent over IPC, cleared on session end** — and the widened crash-dump window is a **NAMED LIMIT**, ratified without a council round-trip because a heap-reading attacker can already read the child's environment block (same excluded threat class, longer duration, no new class). Spec §3.1 gives the field comment near-verbatim; it goes ON the match-set field, because that is where the next reader will ask "why is a key still in memory?".
- **D33 resolution (e)** — carry bounded at **`maxSecretLen − 1`** with a **short timer flush**: a TUI pausing mid-prefix must not stall rendering. Spec §3.2 uses 50 ms as a reasoned guess — you **measure and report** the observed release latency, and adjust if perceptible.
- **D33 Q4, Qwen dissent (preserved):** the PTY stream is an agent-controlled surface and scrubbing risks false confidence. Outvoted on Constraint-1 grounds (the buffer and transcripts are Chorus-controlled) — **acknowledge the dissent durably** (commit message or code comment) so the next reader knows the mechanism was contested and on what grounds.
- **D35** (RESOLVED 2026-07-22): the scrubber is its own task, **before** injection — same principle as the 3-1 logger: redaction before the secret exists. Your commit having zero registered secrets is the point, not an accident.
- **D5** (still standing until 3-6): `spawn`'s env line and comment are untouched.
- **F5/F10 lineage (context for why replay matters):** panes remount on sibling close and on the 3-4 view switch; `attach()` replays `session.buffer` every time. A scrubber wired anywhere downstream of the buffer passes the live-stream check and **fails replay** — that asymmetry is your load-bearing runtime check (§10 item 3).
- **F20**: redirected AppData — quote project ids in any dump.
- **G4** (mandatory): `npm run grep:secrets` clean before commit, run **after** the sweep and purge, not instead of it.

## §7 Implementation Scope

Follow the Exact Scope table in `Task-3-5.md` and the near-final code in `ImplementationSpec-3-5.md` §§2–3.

| File | Change |
|------|--------|
| `src/main/services/scrubber.ts` | **Create.** The pure streaming core: `CREDENTIAL_PLACEHOLDER`, `Scrubber` interface (`push`/`flush`/`pendingLength`), `createScrubber(secrets)` — longest-first replacement, bounded held tail via `heldSuffixLength`, **identity fast path returning the SAME string reference when no secrets are registered**. No `electron`, no `node-pty`, no timers. The module-header honesty comment (spec §2.1) states exact-value-vs-shape and the three named limits. |
| `src/main/services/scrubber.test.ts` | **Create.** The task doc's full table — correctness (identity, single/multiple/two-secrets/overlapping/adjacent) and boundaries (**the all-split-points loop**, three-chunk split, **false-prefix release**, the observable carry bound `sum(outputs) + pendingLength() === sum(inputs)`, `flush` semantics, order preservation). |
| `src/main/services/sessionManager.ts` | **Edit.** `PtySession` gains `scrubber` + `scrubTimer` (with the resolution-(a) carve-out comment ON the fields); `launch()` gains `secrets: readonly string[] = []` (zero callers); the ingest handler becomes clear-timer → `emit(scrubber.push(data))` → schedule flush if `pendingLength() > 0` (spec §3.2 verbatim, incl. the ordering-correctness comment); `onExit` flushes before notifying; `dispose()` clears timers. `SCRUB_FLUSH_MS = 50` (measured, adjustable). |

Nothing else. If a change seems to require another file, raise it loudly in the summary.

### Key invariants

- **Identity is free:** with zero registered secrets, `push(chunk)` returns the same reference — no copy, no scan, no allocation. Every session pays this on every chunk forever.
- **One scrub per chunk:** buffer and listeners consume the SAME scrubbed string via the single `emit` helper. Two `push` calls on one chunk corrupts the carry.
- **The raw `data` is dead after the scrub call** — not logged, not measured, not passed anywhere.
- **Ordering:** concatenation of all `push` returns + `flush` = input with secrets replaced; a pending flush can never overtake a later chunk (clear-first-then-push makes it correct by construction — Node is single-threaded, a timer cannot interleave inside the handler body).
- **The match set dies with the session object** — the closure is the storage; there is no separate structure to forget to clear.
- **`RegExp` is banned in the matcher** — a regex built from a secret means constructing a source string containing key material (spec §2.4's `split/join` rationale).
- **Timer lives in `SessionManager`, not the pure module** — the module stays clock-free and trivially testable.

## §8 Strict Non-Goals

- **No injection, no vault import, no credential resolution.** `launch(..., secrets)` ships with **zero callers** — grep-verified. Task 3-6 is the one legal caller.
- **No shape/pattern matching on the PTY stream** — exact values only (§2). `secret-patterns.json` is not imported.
- **No transcript writing** (Phase 7). **No renderer-side redaction, no UI indicator** (D33 risk 5's indicator idea is a Phase-7 candidate, noted, not built).
- **No change to `session:data`'s schema**, no new event, no new IPC, no counters over the wire.
- **No scrubbing of PTY *input*** — output only.
- **No change to `BUFFER_MAX_CHARS`, the trim logic, the listener mechanism, the spawn env line, or the D5 comment.**
- **No logger change** — `scrubSecrets`/`[redacted]` stay exactly as they are; your placeholder is different by design.
- **No restore-path fix** — the restored-BYOK-session gap is 3-6's decision, already flagged in its docs.
- **Do not delete the `wt-24b5c1fe` fixture. Do not revert/stage/commit `docs/` or `TASK-3-4-REVIEW-FABLE.md`. Do not push, open a PR, amend, or rebase.**

## §9 Required Workflow

1. **Ground per §4.** Read `Task-3-5.md` + `ImplementationSpec-3-5.md` in full. The spec's §4 explains which test catches which wrong implementation — read it before writing the tests, not after.
2. **`scrubber.ts` + its tests first**, green in isolation. The boundary algorithm is the only subtle code in this task; get it right before `SessionManager` sees it.
3. **Wire the ingest** (spec §3.2's shape verbatim), the teardown, and the registration seam.
4. **Gates:** `npm run typecheck` + `npx vitest run` + `npm run grep:secrets`.
5. **Runtime verification (§10)** — add the **temporary registration instrumentation**, run items 1–8, **revert it**, re-run typecheck + vitest, and state the revert in the summary (the reviewer checks the commit diff — Task 2-4/3-2 precedent).
6. **Self-review the diff** against `Task-3-5.md`'s Review Checklist — especially: the identity path allocates nothing; the flush cannot reorder; the comments claim no more than the council ruled.
7. **ONE commit.** Narration style of `0e0640a`/`899df07`: a plain-English paragraph a non-technical reader can follow (what gets scrubbed, what honestly does not), then `Technical notes:` bullets — the measured flush latency, the all-split-points result, the Qwen dissent acknowledgment, the zero-callers grep, any spec deviation with its reason. Verify `git config user.email` = `mwilson29072@gmail.com`. `Co-Authored-By:` trailer naming the model that did the work.
8. **Do not push, do not open a PR, do not amend or rebase.**

## §10 Verification Commands

```powershell
npm run typecheck          # zero errors (G1)
npx vitest run             # green — 235 baseline + your scrubber cases
npm run grep:secrets       # (G4) exit 0 — AFTER the runtime sweep and _verify/ purge
```

Grep gates — run and report hit counts:

```powershell
git grep -n "secrets" -- src/main/services/sessionManager.ts        # the parameter + its threading; NO caller passes it
git grep -n "launch(" -- src/main src/shared src/preload src/renderer | grep -v "sessionManager.ts"   # confirm no call site grew a secrets argument
git grep -n "secret-patterns" -- src/main/services/scrubber.ts      # expect: NOTHING (exact-value, not shape)
git grep -n "RegExp\|new RegExp" -- src/main/services/scrubber.ts   # expect: NOTHING
git grep -n "setTimeout\|setInterval" -- src/main/services/scrubber.ts  # expect: NOTHING (timer lives in SessionManager)
git diff --name-only 899df07                                        # expect: exactly the 3 scope files (+ nothing under docs/)
```

App launch: restore ComSpec/PATH (§3d), then:

```powershell
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
```

### Unit tests — the task doc's table, with the two that catch real bugs emphasized

- **The all-split-points loop:** for a planted secret of length *n*, feed `slice(0,i)` + `slice(i)` for **every** `i` in `1..n−1`; assert placeholder present and no ≥8-char fragment survives. A single midpoint split passes several wrong implementations — the loop is the proof.
- **False-prefix release:** `sk-ant-api03-AAAA` then `NOT-THE-KEY` → output contains `sk-ant-api03-AAAANOT-THE-KEY` **intact**. An implementation that drops the carry on divergence silently deletes user output — a data-loss bug no security test notices.
- Identity (same reference), multi-occurrence, two secrets, overlapping secrets (longest wins, no residue), adjacency, three-chunk split, `flush` twice, the observable conservation law `sum(outputs) + pendingLength() === sum(inputs)`, order preservation on a long secret-free input.
- **Fixtures:** obviously-fake values of realistic shape. They will trip `grep:secrets` if key-shaped and long enough — for **committed test fixtures**, stay under the pattern length floors or use shapes the patterns do not claim (the 3-2 rule: if the gate trips on a fixture, the fixture is wrong, not the gate). The *runtime* planted value (below) SHOULD match the `anthropic` pattern — it lives only in `_verify/` and dies in the purge.

### RUN the app, don't just compile (G2) — with temporary instrumentation

**Register a planted fake value** (e.g. `sk-ant-api03-` + ~40 filler chars, generated this session) via a **two-line temporary edit** in the current-tree launch path of `src/main/ipc.ts` (or equivalently a temporary default in `launch()`), clearly marked, **reverted before commit**. Cold boot per §3(e) after adding it — and after every change to it.

1. **Live stream:** launch an agent (Codex recommended), type `echo <planted value>` (or paste it at any prompt via `Input.insertText`), confirm the terminal renders `[REDACTED-CREDENTIAL]` where the value would appear.
2. **Ring buffer:** dump the session's buffer via a CDP-driven `attachSession` call and assert placeholder present, value absent, no ≥8-char fragment.
3. **Replay — the load-bearing check.** Force a remount (filmstrip focus swap, or the 3-4 **workspace → settings → workspace round trip during live output** — finding 6's matrix item) so `attach()` replays from the buffer; assert the replayed text is scrubbed. **A scrubber wired downstream of the buffer passes items 1–2 and fails this one** — that is why it exists. Report exactly how you triggered the remount.
4. **Split across chunks, for real:** emit the value in two writes with a delay between (two `Input.insertText` calls mid-value against a shell prompt, or a small script the agent runs that prints the two halves with a `sleep` between). Assert the reassembled output is redacted.
5. **Timer flush, measured:** emit a proper prefix of the value, then stop. The prefix must appear within the flush interval — **time it and report the number**; if it is perceptible in normal use, raise `SCRUB_FLUSH_MS` and say so.
6. **Non-interference:** a normal session with a registered value that never appears — TUI renders identically (box drawing, colors, spinner); compare screenshots against an unscrubbed baseline captured before your edit. Include one workspace ⇄ settings round trip.
7. **Teardown:** kill the session; a subsequent session with no registration scrubs nothing (identity).
8. **Console hygiene:** zero `An object could not be cloned`, zero uncaught errors, zero unhandled rejections.

**Then: revert the instrumentation, re-run typecheck + vitest, purge planted-value artifacts from `_verify/`, and run `grep:secrets` last.**

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it. **Never claim success you did not directly observe.**

**Specifically may NOT be reported as success:**

- the replay check (item 3) skipped, or "covered by" items 1–2 — it is the only check that distinguishes ingest-scrubbing from downstream-scrubbing;
- a split-across-chunks claim from the unit loop alone, without the **runtime** split emission (item 4);
- a flush claim without the **measured number** (item 5);
- a non-interference claim without the **before/after screenshot comparison** (item 6);
- an identity claim ("no secrets → untouched") verified only by unit test — item 7 is its runtime half;
- a "zero callers" claim without the grep output;
- a commit whose diff still contains the registration instrumentation, or a summary that does not state the revert;
- `grep:secrets` passing because artifacts were purged **before** the runtime sweep ran rather than after.

**F20:** any DB dump quotes the `projects` ids. **If something fails, report DONE_WITH_CONCERNS or BLOCKED with exact evidence** — this phase's reviews have consistently rewarded honest findings (F25 came from one). Known environment conditions (§3 quirks) are not failures.

## §12 Final Reporting Requirements

Write a detailed summary for coordinator review containing:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Commit SHA** + one-line description; confirmation of **exactly one** commit touching exactly the three scope files.
- **Environment statement** (F20) if any DB evidence was taken.
- **The measured flush latency** and the shipped `SCRUB_FLUSH_MS`.
- **Runtime items 1–8 individually** with what was actually observed and artifact filenames — item 3 stating precisely how the remount was forced; item 4 stating how the split emission was produced; item 6 with both screenshots named.
- **Instrumentation statement:** what the temporary edit was, that it is absent from the commit (quote `git show --stat`), and that typecheck + vitest were re-run post-revert.
- **Grep gate results** with hit counts (all six §10 gates).
- **Unit test names + new total** (235 + yours).
- **The honest-limits confirmation:** the module-header comment's three limits quoted, and where the Qwen dissent is acknowledged.
- **Acceptance criteria** from `Task-3-5.md` restated pass/fail, plus Phase-3-Overview's scrubber box.
- **Non-goals confirmation** — each §8 item, explicitly including: no vault import, no `secret-patterns.json` import, no IPC change, no logger change, env line untouched, zero registration callers.
- **Fixture end-state** — worktree fixture intact; `_verify/` purged; `grep:secrets` run last.
- **Residual risks / notes for Task 3-6** — anything learned about the seam it will call: the exact `launch` signature as shipped, the derive-secrets-from-`secretEnv`-values recommendation (spec §5/IS-3-6), and whether anything in the flush/carry behavior bears on injecting real multi-value credentials.
- **Final git output**, fenced: `git status --porcelain` and `git log --oneline -5`.

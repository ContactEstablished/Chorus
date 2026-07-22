# Chorus Phase 3, Task 3-1 Execution Prompt — Carry-Over Fixes + Secret-Safe Logging Spine

_Generated 2026-07-22 against HEAD `04a8a0d`. Ground facts in §3–§4 verified at that commit by direct inspection: `npm run typecheck` exits 0, `npx vitest run` = 142/142 across 7 files, working tree carries **docs-only** changes (§5), the real dev DB holds migrations 1–4 with one `worktrees` row, `git worktree list` shows the main tree + the retained `wt-24b5c1fe` fixture._

## §1 Role

You are the implementation engineer for Chorus **Phase 3, Task 3-1** — the phase's first task. Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; **do not switch or create branches**. Expected HEAD: `04a8a0d` ("Task 2-4 review: Phase 2 closes, milestone re-driven, two findings recorded") or a descendant.

Planning was done by a separate coordinator. Your final summary will be reviewed against the task docs, and **the reviewer WILL re-run your verification independently**, including re-reading the database on the real machine (§11).

**⚠ THIS SESSION MAKES EXACTLY TWO COMMITS.** This is a deliberate, ratified exception to the one-commit-per-session gate (G3), recorded as **D32**, precedent **D24** (Task 2-1's F15 chore) and the standalone `de98679` fix commit:

1. **Commit 1 — chore:** closes two inherited defects, **F21** and **F23**. Nothing to do with logging.
2. **Commit 2 — task:** the pino logging spine.

Do them in that order, each self-contained, each with its own verification pass. Do not squash them.

## §2 Goal

Two independent pieces of work that share one session because both must precede the vault.

**The chore** closes Phase 3's two inherited defects. **F21**: `worktree:remove` currently derives the `git branch -D` authorization from the *dirty-removal* token, so main would force-delete an unmerged branch on a **clean** worktree if such a request arrived — latent, since the shipped UI never sends that combination, but the one data-loss path in Phase 2 whose safety rests on renderer behavior. It gets a **distinct** acknowledgment naming the branch, enforced in main. **F23**: `insertLaunchedLeaf` replaces the entire layout tree when its target is null, which a Ctrl+K palette launch always is — every other pane vanishes, its session becomes a leafless `running` row, and D16's boot heal kills it. It becomes **total**.

**The task** lays the secret-safe logging spine **before Phase 3's first secret exists**. `pino` with a redacting serializer — declared redact paths **plus a free-text key-shape scrub**, because pino's `redact` only inspects object paths and an interpolated key is the likeliest real leak — replaces all 24 main-process `console.*` calls, and a repo secret-grep script turns G4 from an assertion into a command.

Redaction added *after* a secret exists is a retrofit; every log site written in between is one nobody audited. That ordering is the whole point of this task.

## §3 Project Context

Architecture: local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the MAIN process owned by `SessionManager`; the renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`. SQLite via better-sqlite3 (WAL) at `%APPDATA%\chorus\chorus.db`; Drizzle for typed queries ONLY — migrations are a hand-rolled `MIGRATIONS` array + `schema_migrations` runner (D7).

Phases 0–2 are complete. Phase 3 introduces BYOK credentials; **this task introduces none** — it prepares the ground.

Dev machine: Windows 11, PowerShell 7, **Node 22.14.0, git 2.50.0.windows.1**. CLIs: `claude.exe` 2.1.215 (**auth state has been inconsistent — its token has been expired across recent sessions**), `codex-cli` 0.144.6 (npm `.cmd` shim spawned via `cmd.exe /c`). **This task needs agents that RUN and panes that EXIST, not agents that answer prompts** — an unauthenticated Claude Code pane is perfectly adequate for the F23 proof, and Codex is available if you want a responsive TUI.

Environment quirks — all expected, none a bug you caused:

- **(a)** OS toasts disabled system-wide (registry `ToastEnabled=0`); exit-toast logging emits `[notify] toast shown:` then `[notify] toast failed:` — the log line is the pass signal. **You are migrating exactly these two call sites; do not "fix" the toast failure.**
- **(b)** Codex TUI first-run prompts — update prompt (press **2 to Skip, never 1**), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`.
- **(c)** `node-pty` logs `AttachConsole failed` on PTY teardown. Pre-existing noise, not yours.
- **(d)** The automation harness strips `ComSpec` and modifies PATH — restore before launching:
  `$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"` and
  `$env:PATH = "$((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').Path);$((Get-ItemProperty 'HKCU:\Environment').Path)"`.
- **(e)** `TaskStop` kills only the wrapper shell. To stop the app, find the root node process (`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*electron-vite*dev*' }`) and `taskkill /PID <pid> /T /F`, then confirm port 9222 is free. **`electron-vite` does NOT hot-restart the main process on `src/main` edits (renderer HMR only) — and this task edits six main-process files, so budget a real tree-kill cold boot for every logging check.**
- **(f)** Launch the app as: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` from the repo root.
- **(g)** Orphan checks **cannot** grep `tasklist` for claude/codex — many unrelated `claude.exe` run on this machine. **Walk the descendant tree of the electron main PID.** A graceful-quit test is `taskkill` on the electron-main PID **WITHOUT** `/F`; force cleanup is `/T /F`.
- **(h)** Verification driver: **CDP** on `--remote-debugging-port=9222` (`Runtime.evaluate` in IIFEs — top-level `const` collides across evaluates; `Page.captureScreenshot`; `Input.insertText`); install `ws` in the session scratchpad, **never the repo**. `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a PowerShell console — write results to a file.
- **(i) The `sqlite3` CLI is NOT installed.** DB inspection = a script requiring better-sqlite3 **by absolute repo path**, run via `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe dump.js out.json`. **Known flake: intermittently writes no file on the first invocation with no error — retry once.** `_verify/` is gitignored (`.gitignore:165`), so harness artifacts there cannot be committed by accident; read `_verify/2-1-dump.js` for the pattern. **Task docs older than 2026-07-21 show a wrong `sqlite3 …` invocation — do not copy a command out of them.**
- **(j)** Because CDP `Runtime.evaluate` reaches `window.chorus`, you can send **crafted IPC payloads the shipped UI would never produce**. That capability is the only way to test F21, and §10 requires you to use it.

### Dev-machine baseline — coordinator-verified 2026-07-21/22, do NOT "clean up"

- Migrations **1, 2, 3, 4** (v4 `applied_at` `2026-07-20T16:57:49.534Z`, untouched). **This task adds NO migration** — the count must still read 4 when you finish.
- Projects: **`985d547b-d152-4a07-9094-ddb8da56ef8f` = "Chorus"**, root `C:\Projects\ContactEstablished\Chorus`. **`f47ac10b-58cc-4372-a567-0e02b2c3d479` = "Chorus-Second"**, root **`C:\Projects\ContactEstablished`** — the PARENT directory (**F22**; docs long claimed `…\Chorus-Second`, which was never true). That parent is **not** a git repo.
- Sessions: one `claude` + one `codex`, **both `exited`**, both `worktree_id` NULL.
- **`worktrees` holds ONE row:** `9ba9b0da-cecd-4960-815d-f36166cf8c00`, `status='detached'`, `session_id NULL`, branch `chorus/Chorus/24b5c1fe`, **`base_branch ''`**, project `985d547b…`, path `C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe`.
- `git worktree list` = the main tree + `C:/Projects/ContactEstablished/.chorus/Chorus/wt-24b5c1fe`.
- **⚠⚠ THAT ROW, ITS DIRECTORY, AND ITS BRANCH `chorus/Chorus/24b5c1fe` ARE A RETAINED REGRESSION FIXTURE — DO NOT REMOVE ANY OF THE THREE.** It was adopted by the app's own reconcile and is the standing test case for empty-`base_branch` guards and population-4 adoption. **Your F21 proof is a destructive test: build your OWN throwaway worktree for it (§10).** Destroying the fixture is a reportable regression, not a tidy-up.
- Leftover `chorus/*` branches with no worktree — normal under D26 Q4's no-auto-delete default, leave them: `39b6f2fe`, `54098146`, `605843db`, `ca1eff01`, `cc30c7be`.

## §4 Ground Yourself First (Read BEFORE Editing)

Docs, in this order:

- `CLAUDE.md` — locked rules (sessions in main; Zod in main only; D14 plain-object IPC payloads; **ask before adding dependencies** — `pino` is the one already approved, see D30 in §6).
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts (**especially F16, F20, F21, F22, F23**); §6 decisions **D26(i)/(j)** and the Phase 3 kickoff block **D28–D32**; §7 the Phase 3 section.
- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — phase shape, file-ownership matrix, cross-cutting rules, Phase-Level Acceptance Criteria (**the first three boxes are yours**).
- `docs/Features/Foundation/Tasks/Task-3-1.md` — **THE task contract. Scope, non-goals, acceptance criteria. THIS GOVERNS.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-1.md` — exact contents, insertion points, and the rationale for each. **§2–§4 give you near-final code for the F21 predicate, the `insertLaunchedLeaf` rewrite, and `logger.ts`.**

**You do NOT need to read the council briefs** (`CouncilBrief-3.0-Vault.md`, `CouncilBrief-3.1-AdapterInterface.md`). They gate Tasks 3-2 and 3-3 and are awaiting findings; nothing in them blocks you. **Do not act on them.**

### Code state — verified 2026-07-22 at `04a8a0d`; trust this over any older doc line

- `npm run typecheck` exits 0 (node + web). `npx vitest run` = **142/142 across 7 files**: `src/shared/ipc.test.ts` (53), `src/main/services/worktrees.test.ts` (30), `src/shared/layout.test.ts` (26), `src/renderer/src/palette/commands.test.ts` (17), `src/main/services/restore.test.ts` (6), `src/renderer/src/stores/view.test.ts` (5), `src/renderer/src/stores/layout.test.ts` (5).
- **`src/shared/ipc.ts`** — `worktreeRemoveRequestSchema` at **line 226** (fields: `worktreeId`, `deleteBranch?`, `confirmation?`); the pure `dirtyRemovalAllowed` at **line 252**. Schemas live under dated banner comments (`Task 2-2: workspace modes…`, `Task 2-3: cleanup flows…`, `Task 2-4: diff summary…`) — **add nothing new to this file beyond the F21 field and predicate.**
- **`src/main/ipc.ts`** — `registerIpc(sessions, storage, worktrees)`. The `worktree:remove` handler starts at **line 536**; `dirtyRemovalAllowed` is called at **line 554**; **the defective expression is line 568: `forceBranch: req.confirmation === w.path`.** `dirtyRemovalAllowed` is imported at line 43.
- **`src/main/services/worktrees.ts`** — `removeWorktree(worktreeId, opts)` at **line 305**. Inside: `branchDelete(row.repoRoot, row.branch, false)` at **321** (the plain `-d`), and `branchDelete(row.repoRoot, row.branch, true)` at **326** — **the ONLY `-D` emission site in the codebase**, reached only when `opts.forceBranch` is set AND the error is an unmerged refusal. Note line **319**: `if (opts.deleteBranch && row.branch !== '')` — branch deletion is already skipped for an empty branch. **Do not modify this file.**
- **`src/renderer/src/stores/layout.ts`** — `SplitTarget` interface at line **7**; **the defective `insertLaunchedLeaf` at line 55**. Its current body is `const root = target && this.tree ? splitPane(...) : createLeaf(newSessionId)` followed by an unconditional `this.tree = { version: 1, root }`.
- **`src/shared/layout.ts`** — `splitPane` at **line 48**; **it returns the tree UNCHANGED when `targetSessionId` is not found** (line 56 / line 65), which is the second half of the F23 defect. `collectSessionIds` at **129**, `findLeaf` at **135**. Both are exported. **Do not modify this file.**
- **`src/renderer/src/App.vue`** — `import { useLayoutStore, type SplitTarget } from './stores/layout'` at line **13** (the type is already imported); `const splitTarget = ref<SplitTarget | null>(null)` at **27**; `effectiveFocused` computed at **61**; `openLaunchDialog(target: SplitTarget | null = null)` at **70** (the palette calls it with **no argument**); `function onLaunched(...)` at **197**; **the call to fix is line 216: `layout.insertLaunchedLeaf(splitTarget.value, snapshot.sessionId)`**. Confine your edit to `onLaunched`.
- **The 24 `console.*` call sites** — `src/main/index.ts`: 84, 109, 130, 143. `src/main/ipc.ts`: 443, 455, 593. `src/main/services/notifications.ts`: 26, 27 (**line 25 is a COMMENT mentioning the console — reword it, it is not a call**). `src/main/services/sessionManager.ts`: 125, 142, 150, 162, 167. `src/main/services/storage.ts`: 188, 193. `src/main/services/worktrees.ts`: 410, 427, 447, 451, 456, 472, 475, 478.
- **Bundling:** `electron.vite.config.ts` declares `main: {}` with no explicit externalization, yet the built `out/main/index.js` `require()`s `better-sqlite3`, `node-pty`, `zod`, and `@electron-toolkit/utils` — electron-vite already externalizes `package.json` dependencies. **Adding `pino` to `dependencies` needs no build-config change**; confirm the rebuilt bundle `require`s it rather than inlining it.
- **There is no `scripts/` directory yet** — you create it for `secret-grep.mjs`.
- `src/preload/index.d.ts` is **never hand-edited** (`ChorusApi` is inferred). This task touches neither preload file.

### Git checks (run first)

```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: docs-only entries (see §5)
git log --oneline -1        # expect: 04a8a0d or descendant
git config user.email       # expect: mwilson29072@gmail.com
git worktree list           # expect: main tree + .chorus\Chorus\wt-24b5c1fe
git branch --list "chorus/*"
```

## §5 Pre-existing Changes Warning

**The working tree is NOT clean. It carries docs-only changes from the Phase 3 kickoff:**

```
 M docs/Features/Foundation/roadmap.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3.0-Vault.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3.1-AdapterInterface.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-1.md
?? docs/Features/Foundation/Tasks/Phase-3-Overview.md
?? docs/Features/Foundation/Tasks/Task-3-1.md
```

Plus this prompt itself (`docs/Features/Foundation/Tasks/Task-3-1-ExecutionPrompt.md`).

**These may or may not already be committed by the time you start** — the coordinator commits kickoff docs separately, and that may have happened. Either way the rule is identical: **do not revert, stage, or commit anything under `docs/`.** Your two commits contain only source files you changed for this task.

If `git status --porcelain` shows anything **outside `docs/`** at session start, **stop and ask.**

`_verify/` is gitignored — add harness artifacts there freely.

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate.

- **D1** (locked): all Zod validation in main only — preload and renderer stay Zod-free (page CSP forbids the eval Zod compiles parsers with).
- **D3** (locked): sessions live in main; the renderer never spawns processes.
- **D4** (locked): verify a tool's flags/API against its own docs at execution, never from training memory. **Relevant here: pino's `hooks.logMethod` signature and `redact` options against the installed pino's own typings.**
- **D14** (locked): renderer→main IPC payloads must be plain objects.
- **D16** (RESOLVED 2026-07-19): the restore contract. Its **invisible-process guard** — a `running` row with no layout leaf is healed to `exited` **before any spawn** — is what converts F23's vanished panes into dead agents. You are removing the cause, not the guard. **Do not touch the restore engine.**
- **D25** (RESOLVED 2026-07-20): F14 stays deferred — **do not change restart events or add a restart driver.**
- **D26(i)/(j)** (RESOLVED 2026-07-20, council CR-2.0): `--force` reaches git ONLY inside the gated dirty-removal path; branch deletion runs `git branch -d`, an unmerged refusal is surfaced, and `-D` escalation requires a typed acknowledgment. **F21 is the amendment: that acknowledgment must be its OWN token, not the dirty-removal one.**
- **D28** (RESOLVED 2026-07-21): Phase 3 is scoped to its milestone. **This task ships no vault, no adapter, no settings, no injection.**
- **D30** (RESOLVED 2026-07-21): **`pino` is approved as a dependency** — PLAN §2 names it in the locked stack. It arrives with a redacting serializer in **this task**, before any secret exists. **No transport, no `pino-pretty`, no rotation** (Phase 7). **`pino` is the ONLY dependency you may add. Anything else — including a transport or a pretty-printer — requires stopping and asking.**
- **D32** (RESOLVED 2026-07-21): **F21 and F23 land as a flagged chore commit at the start of this task; G3 is amended for this one session to TWO commits.** F21's fix is a **main-side gate only** — no renderer affordance — which leaves `-D` with zero callers, the same dormant state `--force` sat in between Tasks 2-1 and 2-3.
- **F16** (found Task 2-1): **SQLite foreign keys ARE enforced.** Not directly in your path, but it is why `deleteSession` detaches first — do not disturb that ordering.
- **F20 — KNOWN ENVIRONMENT CONDITION, stated as fact, not suspicion.** Execution sessions here run with a **REDIRECTED `AppData` but a REAL `C:\Projects`**. `$APPDATA` prints the correct string because the redirection is at the storage layer, not the variable. **Consequences: (1) your filesystem/git evidence is trustworthy; (2) your DATABASE evidence may describe a different DB and the coordinator WILL re-verify it; (3) this is an environment artifact — no dishonesty is implied.** Presenting a redirected dump as this machine's *without flagging it* is the only thing that counts against you. **Dump the `projects` table in every DB dump and quote the ids** (§11).
- **F21** (found by coordinator review of Task 2-3, 2026-07-21) — **YOUR SCOPE THIS TIME.** Earlier prompts told implementers not to touch it; that deferral has ended. **Coordinator ruling, quoted:** D26(j)'s "same typed-confirmation acknowledgment" was written for the dirty-removal case; *overloading that one token to mean two different things (destroy uncommitted files / destroy unmerged commits) is the defect.* **Additional constraint found at kickoff:** `branchForceAllowed` must also reject an **empty** branch, because population-4 adopted rows are born with `branch = ''` — **the standing dev fixture is exactly such a row** — and without the guard an empty-string acknowledgment would license a force-delete of a nameless branch.
- **F22** — Chorus-Second's `root_path` is `C:\Projects\ContactEstablished` (the parent), which is not a git repo.
- **F23** (found by the Task 2-4 implementer, coordinator-confirmed 2026-07-21) — **YOUR SCOPE.** A palette launch replaces the whole layout tree; surviving sessions become invisible, become leafless `running` rows, and are healed to `exited` at the next boot — silently killing those agents. No on-disk data loss (agent work lives in files/worktrees), but the session and its scrollback are gone. **Kickoff review found a second defect in the same expression:** `splitPane` returns the tree unchanged for an unknown target, so a **stale** split target silently drops the newly launched leaf — same outcome, different route. **Fix both; a fix for only the null case leaves the class open.**

## §7 Implementation Scope

Follow the Exact Scope tables in `Task-3-1.md` and the near-final code in `ImplementationSpec-3-1.md` §§2–4.

### Commit 1 — chore (F21 + F23)

| File | Change |
|------|--------|
| `src/shared/ipc.ts` | Add `branchForceConfirmation: z.string().optional()` to `worktreeRemoveRequestSchema` (line 226) with a comment stating it is a **separate** acknowledgment from `confirmation`. Add the pure exported **`branchForceAllowed(wt: {branch: string}, ack: string \| undefined): boolean`** beside `dirtyRemovalAllowed` (line 252) — **it must return false for an empty `wt.branch`** (F21 constraint, §6). |
| `src/main/ipc.ts` | Line 568 only: replace `forceBranch: req.confirmation === w.path` with `forceBranch: branchForceAllowed(w, req.branchForceConfirmation)`. Add the import. **Do not touch `forceDirty`** — `--force` for a dirty worktree stays gated by `dirtyRemovalAllowed` per D26(i). |
| `src/renderer/src/stores/layout.ts` | Rewrite `insertLaunchedLeaf` (line 55) to be **total** — spec §3.2 gives the body. Only the `!this.tree` branch may assign a fresh single-leaf tree; a populated tree always splits; the anchor is `target.targetSessionId` **when `findLeaf` confirms it exists**, else `collectSessionIds(root)[0]`; direction defaults to `'row'`. Extend the `../../../shared/layout` import. |
| `src/renderer/src/App.vue` | In `onLaunched` (line 197), at line 216: when `splitTarget.value` is null and `layout.tree` is non-null, synthesize `{ targetSessionId: effectiveFocused.value, direction: 'row' }` so a palette launch splits the focused pane. `SplitTarget` is already imported (line 13). **Confine the edit to `onLaunched`.** |
| `src/shared/ipc.test.ts` | `branchForceAllowed` cases + the widened schema (see §10). |
| `src/renderer/src/stores/layout.test.ts` | The F23 regression cases (see §10). |

### Commit 2 — task (logging spine)

| File | Change |
|------|--------|
| `package.json` | Add **`pino`** to **`dependencies`** (not devDependencies — main requires it at runtime). Add `"grep:secrets": "node scripts/secret-grep.mjs"`. |
| `src/main/services/logger.ts` | **Create.** Spec §4.2 gives near-final code: the pino instance, `REDACT_PATHS` (exported), and the pure exported **`scrubSecrets(text)`**. **Both mechanisms are required** — redact paths for structured fields, scrub for free text. |
| `src/main/services/logger.test.ts` | **Create.** See §10. |
| `src/main/index.ts` | 4 sites (84, 109, 130, 143); initialize the logger at the top of the boot sequence. |
| `src/main/ipc.ts` | 3 sites (443, 455, 593). |
| `src/main/services/notifications.ts` | 2 sites (26, 27) + reword the stale comment at line 25. |
| `src/main/services/sessionManager.ts` | 5 sites (125, 142, 150, 162, 167). The spawn-failure site passes an `err` object — use pino's `logger.error({ err }, msg)` form. |
| `src/main/services/storage.ts` | 2 sites (188, 193). Keep the warn level on 193. |
| `src/main/services/worktrees.ts` | 8 sites (410, 427, 447, 451, 456, 472, 475, 478). **⚠ Preserve the reconcile summary's EXACT wording** — `N row(s) across M repo(s); K surfaced` — it is what the coordinator's regression evidence greps for. |
| `scripts/secret-grep.mjs` | **Create** (new directory). Plain Node ESM, no dependency. |

**Explicitly do NOT touch:** `src/main/services/worktrees.ts` *logic* (only its log calls), `src/main/services/git.ts`, `src/main/services/cliDetect.ts`, `src/main/services/restore.ts`, `src/main/db/schema.ts` (**no migration v5**), `src/shared/layout.ts`, `src/preload/*`, `src/renderer/src/components/WorktreePanel.vue`, `src/renderer/src/components/TerminalPane.vue`, `src/renderer/src/palette/commands.ts`, any other store. If a change seems to require another file, **raise it and justify it loudly in the summary.**

### Key invariants

- **`branchDelete(..., true)` is reachable ONLY through `branchForceAllowed`.** The old `req.confirmation === w.path` expression must be **gone**, not merely supplemented.
- **`branchForceAllowed` rejects the path token and an empty branch**, both with named tests.
- **`insertLaunchedLeaf` cannot discard a populated tree on any input.** The single-leaf assignment appears exactly **once**, inside the `!this.tree` branch.
- **A stale anchor never drops the launched leaf** — guarded with `findLeaf`, not left to `splitPane`'s silent no-op.
- **Message scrubbing is real**, not redact-paths-only. A redact-paths-only implementation passes a naive unit test and fails the actual leak case; §10 requires you to prove both halves at runtime.
- **The scrub does not mangle ordinary logs** — a Windows path, a UUID, a 40-char git SHA, and a `chorus/<repo>/<8hex>` branch name must survive **byte-identical**.
- **One pattern list**, shared between `logger.ts` and `scripts/secret-grep.mjs`. Two divergent lists are worse than no gate.
- **No `console.*` remains anywhere in `src/main`** (outside comments).
- **Nothing in this task touches PTY output, the ring buffer, or `session:data`.** Whether that stream is scrubbed is council question CR-3.0 Q4 and is **not yours to pre-empt**.

## §8 Strict Non-Goals

- **No vault, no `safeStorage`, no credential schema, no migration v5, no adapter, no settings view, no env injection** — Tasks 3-2 through 3-5.
- **No PTY-output / ring-buffer / `session:data` scrubbing** — CR-3.0 owns that ruling (§7 invariants).
- **No `-D` affordance in the UI.** `WorktreePanel.vue` is deliberately untouched; after your gate, `-D` has zero callers. The existing unmerged-refusal message already tells users to run `git branch -D` themselves. **Do not add an escalation button** — that is a product decision nobody has made.
- **No log rotation, no file transport, no `pino-pretty`, no second dependency** (D30).
- **No semantic change to logging** — the migration is mechanical: same events, same information, same bracketed prefixes. **Do not add, remove, or re-level a log site**, and do not "improve" a message while you are in there.
- **No renderer logging change** — the renderer keeps its `console` usage; only `src/main` migrates.
- **No restart-driver or restart-event change** (D25/F14).
- **No change to `splitPane`, `collectSessionIds`, or `findLeaf`** in `src/shared/layout.ts` — the fix belongs in the caller.
- **Do not delete the `wt-24b5c1fe` worktree, its DB row, or branch `chorus/Chorus/24b5c1fe`** (§3).
- **Do not revert, stage, or commit anything under `docs/`** (§5).
- **Do not push, open a PR, amend, or rebase.**

## §9 Required Workflow

1. **Ground per §4.** Read `Task-3-1.md` and `ImplementationSpec-3-1.md` in full before editing.
2. **Commit 1 first, complete.** Implement F21 (schema → predicate → handler), then F23 (store → caller). Write the unit tests. Run `npm run typecheck` + `npx vitest run`. **Then run the F21 and F23 runtime proofs (§10 items 1–3)** — the F21 proof needs a throwaway worktree and a crafted CDP payload, so budget for it. Self-review the diff against the `Task-3-1.md` Review Checklist. **Commit.**
3. **Commit 2 second.** Install `pino`; author `logger.ts` + its tests; migrate the 24 sites file by file; author `scripts/secret-grep.mjs`. Run `npm run typecheck` + `npx vitest run` + `npm run grep:secrets`. **Then run the redaction runtime proof (§10 items 4–6).** **Commit.**
4. **Commit narration** — style of `94f062c` / `6dfd146` / `2f0a35f`: a plain-English paragraph a non-technical reader can follow, then a `Technical notes:` bullet list. Commit 1 states what F21 and F23 were and what an ordinary user would have experienced. Commit 2 states the **D4 outcome** for pino's API, that **both** redaction mechanisms are wired, and any deviation. Verify `git config user.email` = `mwilson29072@gmail.com`. End each with the `Co-Authored-By:` trailer naming the model that did the work.
5. **Do not push, do not open a PR, do not amend or rebase existing commits.**

## §10 Verification Commands

```powershell
npm run typecheck          # zero errors (G1)
npx vitest run             # green — 142 existing + your new cases
npm run grep:secrets       # after commit 2 — must exit 0 on a clean repo
git --version              # 2.50.0.windows.1
```

Grep gates — run and report hit counts:

```powershell
git grep -n "console\." -- src/main          # after commit 2: nothing outside comments
git grep -n "forceBranch" -- src/main        # exactly one authorization site
git grep -n "branchDelete" -- src/main       # two call sites, both in worktrees.ts (-d and gated -D)
```

App launch: restore ComSpec/PATH (§3d), then:

```powershell
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
```

### New unit tests

`src/shared/ipc.test.ts` — under a `Task 3-1` banner:

| Case | Expected |
|---|---|
| `branchForceAllowed({branch:'chorus/X/ab12'}, 'chorus/X/ab12')` | `true` |
| `branchForceAllowed({branch:'chorus/X/ab12'}, undefined)` | `false` |
| `branchForceAllowed({branch:'chorus/X/ab12'}, '')` | `false` |
| `branchForceAllowed({branch:'chorus/X/ab12'}, 'chorus/X/ab13')` | `false` |
| **`branchForceAllowed({branch:'chorus/X/ab12'}, '<the worktree PATH>')`** | **`false` — name this the F21 regression** |
| **`branchForceAllowed({branch:''}, '')`** | **`false` — the adopted-row guard** |
| `worktreeRemoveRequestSchema` with and without `branchForceConfirmation` | both accepted (backward compatible) |

`src/renderer/src/stores/layout.test.ts`:

| Case | Expected |
|---|---|
| null tree + null target | a single root leaf |
| **populated tree + null target** | **the tree GROWS — every pre-existing id from `collectSessionIds` still present, plus the new one. Name this the F23 regression.** |
| populated tree + **stale** target id | the new leaf still lands (first-leaf fallback); no id dropped |
| populated tree + valid target | splits at that target, in the requested direction |

`src/main/services/logger.test.ts`:

- each pattern in the secret list scrubs to the placeholder;
- **multiple occurrences in one string** all replaced (the `g` flag is easy to forget);
- **ordering:** a string containing `sk-ant-…` leaves **no residual `sk-ant-` prefix**;
- **non-secrets survive byte-identical:** `C:\Projects\ContactEstablished\Chorus`, the UUID `985d547b-d152-4a07-9094-ddb8da56ef8f`, a 40-char git SHA, and `chorus/Chorus/24b5c1fe`;
- `REDACT_PATHS` contains the field names the vault will use.

Use **synthetic keys of realistic shape** only — never a real credential.

### RUN the app, don't just compile (G2)

Screenshot each step. Cold-boot after every main-process edit (§3e).

**Commit 1 proofs:**

1. **F21 — the authorization proof.** **Build a THROWAWAY worktree** (`git worktree add` on a fresh `chorus/Chorus/<something>` branch), give its branch **an unmerged commit** so a plain `-d` genuinely refuses, and let the app adopt it via boot reconcile. Then drive `window.chorus.removeWorktree({...})` over CDP with the **crafted pre-fix payload**: `{ worktreeId, deleteBranch: true, confirmation: "<the worktree path>" }` and **no** `branchForceConfirmation`, against the **clean** worktree. **Required post-fix behavior:** the worktree is removed, the surfaced unmerged-refusal message comes back, and **the branch still exists with its commit reachable**. Prove with `git branch --list "chorus/*"` before and after, and report **the exact payload you sent**. Clean up your throwaway branch afterwards. **Do not run this against `wt-24b5c1fe`.**
2. **F23 — the pane-survival proof.** With a **populated** layout (≥2 panes), press `Ctrl+K`, run **"Launch agent…"**, complete the launch. Required: the layout now holds **three** leaves; **every pre-existing session id survives**; the new pane is visible and attached. Capture `pane_layouts.layout_json` **before and after** and show the leaf set **grew** rather than being replaced.
3. **F23 — the boot proof, which is the part that actually killed sessions.** Tree-kill, cold-boot, and confirm **none** of the pre-existing sessions were healed as leafless rows: a boot log free of `[restore] healed running row with no layout leaf` for those ids. Also exercise the **empty state** once (close every pane, launch from the empty state) to confirm the single-root-leaf path still works.

**Commit 2 proofs:**

4. **Log parity.** Cold-boot and confirm the migrated lines still carry the same information in pino's structured form — **specifically the `[worktrees] reconcile:` summary with its exact `N row(s) across M repo(s); K surfaced` wording**, and that the reconcile line still precedes the `[restore]` lines.
5. **Redaction — BOTH halves.** With a planted fake key of realistic shape (e.g. `sk-ant-api03-` + ~40 filler chars — synthetic, never real): **(a)** log an object carrying it under a redacted path → emitted as the placeholder; **(b)** log it inside an **interpolated template-literal message** → also emitted as the placeholder. **(b) is the one that fails when only `redact` paths are configured — both must be shown.**
6. **The gate works in both directions.** Point `npm run grep:secrets` at a file containing the planted key → **exits non-zero**. Remove every planted key, re-run → **exits zero**. Show both.
7. **Console hygiene** across everything: zero `An object could not be cloned` (D14), zero uncaught errors, zero unhandled rejections.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it. **Never claim success you did not directly observe.**

**Verification-provenance rule (enforced — F20, §6):** your **filesystem and git evidence is trustworthy**; your **database evidence may describe a different DB**, and the coordinator **will** re-verify against the real `%APPDATA%\chorus\chorus.db` (projects `985d547b-d152-4a07-9094-ddb8da56ef8f` = Chorus, `f47ac10b-58cc-4372-a567-0e02b2c3d479` = Chorus-Second). **Dump the `projects` table alongside every DB dump and quote the ids you actually saw.** If they do not match, say so plainly and prominently — that is a useful signal, not a failure on your part.

**Specifically may NOT be reported as success:**

- an F21 result you reasoned about from code rather than obtained by **actually sending the crafted payload** and reading the branch list before and after;
- an F21 proof run against a branch with **no unmerged commit** — then `-d` succeeds on its own and the test proves nothing;
- an F23 "panes survive" claim from the UI alone without the **before/after `pane_layouts` capture**;
- the F23 boot proof if you did not actually **cold-boot** (electron-vite does not restart main — §3e);
- **a redaction claim covering only the structured path** — item 5(b), the interpolated message, is the real test;
- a `grep:secrets` claim without showing it **fail** on a planted key as well as pass on a clean repo;
- "no `console.*` remains" without the grep output.

**If something fails, that is a legitimate and valuable outcome — report `DONE_WITH_CONCERNS` or `BLOCKED` with exact evidence.** A truthfully-failed proof is worth far more than a claimed one.

Known environment conditions are **not** failures — note them and move on: the dump-script first-run flake (§3i), Codex first-run prompts (§3b), `AttachConsole failed` teardown noise (§3c), disabled OS toasts (§3a), Claude Code's expired token.

## §12 Final Reporting Requirements

Write a detailed summary for coordinator review containing:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **BOTH commit SHAs** + one-line descriptions, in order, with confirmation they were **not** squashed (D32).
- **Environment statement** — confirm the runtime evidence came from this machine's dev DB (**quote the project ids you saw**), or state plainly that it did not (§11).
- **D4 report for pino** — what the installed pino's typings actually specify for `hooks.logMethod` and `redact`, and whether you used the hook or an equivalent wrapper to achieve message scrubbing.
- **F21 evidence** — the exact crafted payload sent, the branch list before and after, and confirmation the branch and its unmerged commit survived. State plainly that `-D` now has **zero callers**.
- **F23 evidence** — before/after `pane_layouts.layout_json` leaf sets, the cold-boot log excerpt showing no leafless healing, and the empty-state check.
- **Redaction evidence** — the emitted lines for **both** the structured field and the interpolated message, and the `grep:secrets` fail-then-pass demonstration.
- **Grep gate results** with hit counts: `console.` in `src/main`, `forceBranch`, `branchDelete`.
- **Files changed** — one-line rationale each, grouped by commit; anything beyond §7's tables flagged loudly with justification.
- **Deviations** from `ImplementationSpec-3-1.md`, with why. (Its code blocks are starting points, not mandates — adapting them to the surrounding file's conventions is expected and is not a deviation. Changing the *guarantee* is.)
- **Verification transcript** — typecheck; vitest with new test names and the new total; runtime items 1–7 individually with what was actually observed (screenshots/dumps by filename).
- **Acceptance criteria** from `Task-3-1.md` restated pass/fail, plus the **first three** Phase-Level Acceptance Criteria boxes in `Phase-3-Overview.md` (F21 closed, F23 closed, redacting logger).
- **Non-goals confirmation** — each §8 item untouched, **explicitly including** that you did not touch PTY output / the ring buffer / `session:data`, and did not add a `-D` UI affordance.
- **Fixture end-state declaration** — final `git worktree list`, the `worktrees` table, and `git branch --list "chorus/*"`. **Confirm `wt-24b5c1fe`, its row, and branch `chorus/Chorus/24b5c1fe` all still exist**, and that any throwaway worktree/branch you created for the F21 proof was cleaned up.
- **Migration count** — confirm `schema_migrations` still reads **4** (this task adds none).
- **Residual risks / notes for Task 3-2** — anything the vault task should know, particularly redact paths the vault will need to add and whether you saw anything bearing on CR-3.0's open PTY-stream question (observation only — **do not act on it**).
- **Final git output**, fenced: `git status --porcelain` and `git log --oneline -4`.

# Task 10.1-1 — Execution Prompt (paste into a fresh session)

You are the **Coordinator** for **Task 10.1-1 — One launch composition, every caller (closes F115)**, the
first task of Engine Phase 10.1 and the gate the rest stands on.

**Repo root:** `C:\Projects\ContactEstablished\Chorus` (main checkout, `main` is checked out there)

**Expected branch:** `main` at `3e391a0`. Confirm with `git branch --show-current` and `git log --oneline -1`.
**Do not switch branches without instruction.**

---

## ⚠ GATE 0 — MIGRATION IS LOCKED AT v23. VERIFY BUT DO NOT CHANGE IT.

**This task adds NO migration.** Phase 10.1 is the measurement tier, not the schema tier. Measured at
`3e391a0` on 2026-09-12:

```
MIGRATIONS.length = 23
Highest version marker = v23
Next free = v24 (reserved for Task 10.1-3)
```

✅ **Verified 2026-09-12, not recalled.** `v24` is free in code and in the installed DB
(`%APPDATA%\chorus-app\chorus.db`, read from a copy with `-wal` and `-shm`). **Your task must not touch
`MIGRATIONS` array.**

⚠ **THE TWO GREP GATES THIS SECTION ORIGINALLY CARRIED WERE WRONG IN BOTH THE FILE AND THE METHOD, AND ARE REPLACED — THE MISTAKE IS LEFT DESCRIBED BECAUSE IT IS THE ONE THIS REPO MAKES MOST.**
They read `src/main/db/schema.ts`, but **`MIGRATIONS` lives in `src/main/services/storage.ts`** — `schema.ts` holds the Drizzle table definitions. Run against `schema.ts`, `grep "MIGRATIONS" … | wc -l` returns **2**, not 23, so the gate looks failed while nothing is wrong.

⚠ **AND A LINE COUNT IS THE WRONG INSTRUMENT ANYWAY.** The roadmap's standing **G6** rule is that the array is **AST-parsed, never grepped**, because its SQL contains backticks and a backtick-based count of a backtick-containing array is a lie. Use this instead — it needs no new dependency, `typescript` is already in the tree:

```bash
# Confirms you did NOT add a migration. Expect: length=23 nextFree=v24
node -e "const ts=require('typescript'),fs=require('fs');const sf=ts.createSourceFile('s.ts',fs.readFileSync('src/main/services/storage.ts','utf8'),ts.ScriptTarget.Latest,true);let n=null;(function v(x){if(ts.isVariableDeclaration(x)&&x.name.getText()==='MIGRATIONS'&&x.initializer&&ts.isArrayLiteralExpression(x.initializer))n=x.initializer.elements.length;ts.forEachChild(x,v)})(sf);console.log('length='+n+' nextFree=v'+(n+1))"
```

**Expected output: `length=23 nextFree=v24`.** If it prints anything else, STOP — either you added a migration (you must not) or another branch did, and Task 10.1-3’s `v24` claim needs re-checking before anyone proceeds.

---

## ⚠ GATE 1 — PRE-EXISTING DIRTY TREE. LIST THESE; DO NOT COMMIT THEM.

Your working tree has six pre-existing modifications. **Do not revert, stage, or commit these:**

```
 M docs/Features/Foundation/roadmap.md
MM package-lock.json
MM package.json
 M src/renderer/src/components/TerminalPane.vue
?? .claude/
?? .procoder/
?? docs/Features/Engine/
```

Note: `docs/Features/Engine/` is untracked and contains this task's own documents — that is expected.

---

## ⚠ GATE 2 — TEST BASELINE. WRITE IT DOWN NOW.

Baseline measured independently **twice** at `3e391a0` on 2026-09-12:

**90 test files, 3194 tests, all passing.** The suite must end at that or higher. Your final vitest
run must show at least **90 files / 3194 tests** passing.

⚠ `--reporter=basic` does NOT exist in this vitest version — it fails with `ERR_LOAD_URL` and still
exits 0, so it looks green while running nothing. Use plain `npx vitest run` or `--reporter=dot`.

---

## Goal

Give **the options a session launches with** exactly one definition and call it from every path that
starts a PTY. A restored or restarted pane comes back with the effort, model effort, permission mode
and env additions it launched with.

**The problem (F115):** `session:relaunch` already rebuilds these four fields from a persisted launch
profile, but `session:restart` and boot restore pass them as an empty object `{}`. So a pane launched
in Plan mode comes back in Auto (the claude adapter's default) — a silent widening of what the agent
may do unasked.

---

## Ground yourself first — read before editing

**Specification (both are authoritative; where they disagree, the task doc wins on *what*, the spec
wins on *how*):**
- `docs/Features/Engine/Tasks/Task-10.1-1.md` — scope, step-by-step work, test expectations, acceptance
criteria, review checklist.
- `docs/Features/Engine/ImplementationSpecs/ImplementationSpec-10.1-1.md` — exact shapes, placement
rationale, the omitted-key trap, insertion points, the degrade path, verification.

**Roadmap context** — `docs/Features/Foundation/roadmap.md` §7, Phase 10:
- **D33** — the no-unattended-decrypt invariant. `SessionManager` contains ZERO references to the
  vault and **must still contain zero when this lands.** The extracted composition is credential-free
  and SYNCHRONOUS. That synchronicity **is the enforcement**: `vault.decryptForLaunch` returns a
  Promise, so inside a `(row) => LaunchOptions` signature it cannot be awaited (2026-09-12, Matthew).
- **F115 scope, corrected 2026-09-12** — a restored or restarted pane does NOT lose its credential.
  A credentialed session never reaches either spawn: restore heals it to `exited` titled "Credential
  not re-supplied"; restart refuses it inline. What is lost is `effort`, `modelEffort`, `permissionMode`
  and `envAdditions`. The sharpest: **a pane launched in Plan or Manual comes back in Auto.** Closing
  F115 **changes shipped behaviour** and must be called out as such, not buried as a fix.
- **"Three callers" was an undercount, corrected 2026-09-12** — there are FOUR composition sites:
  `session:launch` (ipc.ts:1816-1843), `session:relaunch` (ipc.ts:3237-3255), `session:restart`
  (ipc.ts:2258), and boot restore (sessionManager.ts:600). The first two compose in full; the last two
  compose nothing. Leaving `session:launch` behind would make the claim false on day one.

---

## Implementation scope

**Exact scope from Task-10.1-1.md, table "Exact Scope":**

1. **Create** `src/main/services/launchOptionsCore.ts` — `composeLaunchOptions()`, `makeLaunchOptionsResolver()`,
   `LaunchOptionsResolver` type, `ProfilePlanOptions` type, `LaunchOverrides` interface, `ProfileLookups`
   interface. Pure: no `electron`, no `node:fs`, no `storage`, no `vault`, no `logger`. Lookups and the
   degrade report arrive as callbacks.
2. **Create** `src/main/services/launchOptionsCore.test.ts`. Cover composition, resolver, overrides,
   degrade paths, and the D33 guard (no `secrets`, `credential`, or `route` in the result).
3. **Edit** `src/main/services/sessionManager.ts` — one private field `launchOptions`, one `bindLaunchOptions(resolver)`
   method beside `bindStorage` (:341) and `bindHooks` (:349), and `:600` becomes
   `this.spawn(row.agent as AgentKind, row.cwd, row.id, this.launchOptions?.(row) ?? {})`.
   Update docstrings at `:485-489` (the now-false "passes NO options" claim) and `:205-212`
   (the parenthetical about absent = adapter default).
4. **Edit** `src/main/index.ts` — ⚠ **`src/main/index.ts`, NOT `src/main/services/index.ts`; the latter does not exist** — one `sessions.bindLaunchOptions(...)` beside the six
   existing binds (`:541`, `:571`, `:597`, `:620`, `:625`, `:657`). It MUST precede
   `sessions.restore(...)` at `:1348`.
5. **Edit** `src/main/ipc.ts` — `session:restart` (:2258), `session:relaunch` (:3237-3255), and
   `session:launch` (:1816-1843) call the shared function; the credential blocks stay where they are.
   Rewrite the two false claims at `:1830-1831` ("restore and `session:restart` never reach this
   function at all" — the *function* is still unreached, the *values* now reach them).

**Nothing else.** No ledger code, no schema migration, no UI, no new IPC channel. The suite stays at
114 IPC channel keys.

---

## Resolved decisions you are bound by

- **D33 / the no-unattended-decrypt invariant (2026-09-12, Matthew).** `SessionManager` contains ZERO
  references to the vault and must still contain zero when this lands. The extracted composition is
  **credential-free and SYNCHRONOUS**. The synchronicity IS the enforcement: `vault.decryptForLaunch`
  returns a Promise, so inside `(row) => LaunchOptions` it cannot be awaited, converting a prose
  warning into a compile error.

- **F115 scope, corrected 2026-09-12.** A restored or restarted pane does NOT lose its credential —
  a credentialed session never reaches either spawn (restore heals it to `exited`; restart refuses it
  inline, both via `sessionIsCredentialed`). What is lost is `effort`, `modelEffort`, `permissionMode`
  and `envAdditions`. ⚠ **The sharpest is `permissionMode`: absent means the adapter default and
  claude's is `auto`, so a pane launched in Plan or Manual comes back in Auto. Closing F115 therefore
  CHANGES SHIPPED BEHAVIOUR and must be reported as a behaviour change, not a fix.**

- **"Three callers" was an undercount, corrected 2026-09-12.** There are FOUR composition sites:
  `session:launch` (ipc.ts:1816-1843), `session:relaunch` (ipc.ts:3237-3255), `session:restart`
  (ipc.ts:2258), and boot restore (sessionManager.ts:600). The first two compose in full; the last two
  compose nothing. Leaving `session:launch` behind would make the claim false on day one.

---

## Strict non-goals

✅ **Explicitly NOT in scope:**

- No ledger code, no `engineLedgerCore.ts`, no `engineLedger.ts` — those are Tasks 10.1-2 and 10.1-3.
- No `schema.ts` / `storage.ts` DDL, no migration `v24`, no new DB column. The test baseline is v23.
- No new IPC channel — `npx vitest run src/shared/ipc.test.ts` must stay green WITHOUT touching its
  channel-count assertions (currently 114).
- No UI.
- No change to `mergeWiringEnv`'s precedence (ipc.ts:1189-1204). Record its newly-reachable trap in
  the code comment; do not fix it. Phase 10.3 owns that decision.
- No `withMcpEnv` on the restore path — relaunch wraps its options in it, restore must not start to.
- No credential resolution reachable from `SessionManager`.
- No change to WHICH sessions restore: the credentialed heal, the `RESTORE_CAP = 16` tail, the cwd
  guard and the stagger are untouched.
- Do not revert or commit the pre-existing dirty files listed above.

---

## Required workflow

**Coordinator pattern — worker pass → spec review → code-quality review → resolve findings → run
verification → narrate the commit.**

1. Implement the scope above, starting with `launchOptionsCore.ts` as the pure core.
2. Review the result against `ImplementationSpec-10.1-1.md` clause by clause (placement, shapes, omitted
   keys, degrade path, verification).
3. Code-quality review: check for typos, unused imports, docstring accuracy, test coverage.
4. Resolve findings and re-verify.
5. **One intentional commit** in the repo's house style: concise title, then a plain-language description
   a non-technical reader can follow, then technical detail. **The commit message must name the decision
   to keep v23 locked, that this task adds NO migration.**
6. Do not push and do not open a PR unless explicitly asked.

**No `.codex/workflows/subagents/` kit in this repo; do not reference one.**

---

## Verification — run these, do not reason about them

**Compilation and unit tests:**

```
npm run typecheck
npx vitest run src/main/services/launchOptionsCore.test.ts src/main/services/launchProfiles.test.ts
npx vitest run
git diff --stat
```

**Expected results:**

- `npm run typecheck` → exit 0
- New tests plus existing suite = **at least 90 files / 3194 tests, all passing**
- `git diff --stat` shows **only** edits to the five files listed in Implementation Scope

**Grep gates — expected results (return nothing, not comments):**

```
grep -n "Pick<LaunchOptions" src/main/ipc.ts
→ nothing (the composition now lives in one place)

grep -rn "vault\|decryptForLaunch" src/main/services/sessionManager.ts src/main/services/launchOptionsCore.ts
→ nothing (D33 enforcement)

grep -n "async" src/main/services/launchOptionsCore.ts
→ nothing (synchronicity is the enforcement)
```

**IPC channel count (must stay 114 — this task adds no channel):**

⚠ **DO NOT COUNT THIS WITH `grep -c`.** An indentation-based grep over `src/shared/ipc.ts` returns **291**, not 114 — it matches every indented `key:` in every Zod schema in the file. The repo's standing rule is that this enum is **AST-parsed** (a spread assignment would make any count a lie, and a grep cannot see one). The cheapest honest check is the test that already guards it:

```bash
npx vitest run src/shared/ipc.test.ts
```

It must pass **untouched**. Two assertions inside it — `src/shared/ipc.test.ts:3642` and `:4102` — assert `Object.keys(IpcChannel)` has length **114**. ⚠ **If you find yourself editing either number, you have added an IPC channel, which is a non-goal of this task.**

---

## Runtime gates — "run, don't just compile", BOTH HALVES REQUIRED

⚠ **Three-part setup before the runtime half:**

The plain `npm run dev` instance has NO credentials, so profile-backed panes look broken for the wrong
reason. You MUST seed a throwaway user-data-dir.

1. **Copy the credentials database.** From `%APPDATA%\chorus-app`, copy BOTH the `chorus.db` (and its
   `-wal` and `-shm` companion files) **AND the `Local State` file** (it holds the OSCrypt key; without
   it every pre-existing credential blob is undecryptable) into a temporary directory.

2. **Launch with CDP:**
   ```powershell
   $env:REMOTE_DEBUGGING_PORT = '9222'
   $env:ELECTRON_CLI_ARGS = '["--user-data-dir=<seeded-dir>"]'
   npm run dev
   ```
   `REMOTE_DEBUGGING_PORT` becomes `--remote-debugging-port` on the Electron argv; `ELECTRON_CLI_ARGS`
   is parsed as a JSON array (verified at electron-vite:225-226 and :224).

3. **Kill the dev instance by exact match:**
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
     Where-Object { $_.CommandLine -match "remote-debugging-port=9222" } |
     ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   ```
   ⚠ A bare `*9222*` substring match also kills Chrome renderers and the querying shell.

4. **When driving a Vue `v-model` input over CDP**, assigning `.value` leaves the model empty —
   dispatch an `input` event too.

**Half 1 — Restart (proves the function works):**

- Launch a pane on a launch profile that has `permissionMode: 'plan'` (or 'manual') and one or more
  `envAdditions` entries.
- Note the pane's PTY pid (visible in the status bar or task manager).
- Fire `session:restart` (reload from the context menu or via the IPC handler).
- **Assert:** the new PTY's command line carries `--permission-mode plan` (not `auto`), and its env
  carries the same additions.
  ⚠ **The agent PTY is NOT `electron.exe`** — that is the app process you kill in step 3. The PTY is
  whatever the adapter spawned for this agent, so **discover its name first** rather than assuming
  one:
  ```powershell
  # Snapshot BEFORE the restart, compare AFTER - the pid must change.
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'permission-mode' } |
    Select-Object ProcessId, Name, CreationDate, CommandLine | Format-List
  ```
  ⚠ Then identify the NEW process by **`Name` + `CreationDate`, never by a `CommandLine` substring**
  — a `Win32_Process` CommandLine filter **matches its own query process**, so the filter finds
  itself and you measure the wrong thing. Compare argv LENGTHS across the before/after pair rather
  than eyeballing one string.

**Half 2 — Restore (proves the function runs at boot):**

- With that pane still open, quit the app and start it again.
- **Assert:** the restored pane carries both the same `--permission-mode` and `envAdditions`. Same
  measurement as Half 1 on the process that started at boot.

**Proving only Half 1 has NOT closed F115 — Half 2 is the half `sessionManager.ts:600` is about.**

**Control case — prove the bug exists before the fix:**

- Temporarily revert the `:600` change so the restore path still passes `{}`.
- Run both halves again; both should now show `--permission-mode auto` (claude's `defaultLevelId`,
  claude.ts:540).
- Revert the revert and re-verify both halves show the right mode.
- This proves the test can see the bug.

**Negative case — credential panes still refuse:**

- Launch a pane on a credential-bearing launch profile.
- Restart it or restart the app.
- **Assert:** the pane comes back as an `exited` row titled "Credential not re-supplied — relaunch
  from the dialog to re-enter it" (sessionManager.ts:577-580), **never** as a running pane with options.
- If it comes back live, the resolver reached a credential and the task has broken the D33 invariant.

---

## Failure honesty

If a verification command fails for an unrelated environment reason, capture the exact output, explain
it, and do not claim success. If the runtime gate cannot be run at all (app will not launch, seeded
dir fails to load), report `DONE_WITH_CONCERNS` or `BLOCKED` with evidence.

Two specific false-green traps this repo has produced:

- **The lone-CR trap.** `TerminalPane.vue` and `roadmap.md` carry a lone CR byte. The `Edit` tool
  rewrites it as LF for a phantom multi-thousand-line diff. **Run `git diff --stat` after every edit**
  and confirm the line count matches what you changed.
- **Dev worktrees share one database.** A migration claimed on another branch makes yours silently
  no-op — verify against a throwaway `--user-data-dir` instead of the shared main checkout's DB.

---

## Final report — required structure

**Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

**Files changed:**
- (list each file with a one-line reason)

**Build results:**
- `npm run typecheck` → exit code, any errors
- `npx vitest run` → test count before/after (baseline 90 files / 3194 tests)
- Grep gates → exactly what was found (should be nothing)
- IPC channel count → 114 (unchanged)

**Runtime results:** what you actually observed for each half:
- Half 1 (restart): actual argv and env of the restarted pane
- Half 2 (restore): actual argv and env after quit and reboot
- Negative case: credential pane behaviour
- Control case revert proof: before/after screenshots or output

**Review outcomes:** spec-compliance findings and code-quality findings, and how each was resolved.

**Non-goals confirmation:**
- ✅ No schema.ts migration added; v23 still the last entry
- ✅ No new IPC channel; count still 114
- ✅ sessionManager.ts still holds zero references to vault
- ✅ launchOptionsCore.ts is pure (no imports of electron, fs, storage, vault, logger)
- ✅ No `withMcpEnv` on restore path
- ✅ No change to `mergeWiringEnv` precedence

**Behaviour change callout:** a pane launched with `permissionMode: 'plan'` or `'manual'` previously
came back in `'auto'` (the adapter default) on restore/restart. This task **changes that behaviour** to
return the mode the pane was launched with. This is a fix to F115, not a regression.

**Residual risks:**
- (anything found and deliberately not fixed, with reasoning)

**Final state:**
- `git status --porcelain` output
- Commit hash and message

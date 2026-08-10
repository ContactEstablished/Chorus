# Phase 3h — Execution Prompt (paste into a fresh session)

*Authored 2026-08-07 against the code at `78ef546`. **Every fact, line number, count, command and
gate below was re-run while authoring this prompt, at this HEAD.** Where it disagrees with the
roadmap, this document is right and the roadmap is ten commits stale.*

---

## Role

You are the **Coordinator** for **Chorus — Phase 3h: Project Lifecycle & Rail Order**.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main`. **Confirm it; do not switch or create a branch without instruction.**
- **Expected HEAD at start:** `78ef546` *("Release 0.1.2 — the council-answers and reinstall-safety
  build")*. **If HEAD has moved, stop and re-measure the baseline in §"The baseline" before writing
  anything** — do not assume the numbers below still hold.
- **Platform:** Windows 11, PowerShell primary. A Bash tool is also available; each takes its own
  syntax.

## Goal

Give the project rail the four capabilities it has never had — **hide**, **archive**, **delete**, and
**drag-to-reorder** — across **three strictly-ordered tasks**, one narrated commit each.

Today the rail can only add and select. Every project is always shown, ordered by `created_at ASC`
(`src/main/services/storage.ts:646–649`, `src/renderer/src/components/ProjectRail.vue:159`). There is
no way to retire a finished project, tuck one out of sight, remove one added by mistake, or change
the order.

**This phase writes production code.** It also migrates the database and deletes rows, which is why
§3 below is not optional advice.

---

## ⚠ Read this before anything else — six things you cannot infer

### 1. The roadmap is stale and must not be used as a source of numbers

`docs/Features/Foundation/roadmap.md`'s last decision is **D119, accepted 2026-08-04**, and **ten
commits have landed since** (`9aa0596` … `78ef546`). Its most recent measured counts are from
**2026-08-01 at `5ba3b98` against a dirty working tree**:

| | Roadmap says | **Truth at `78ef546`** |
|---|---|---|
| `IpcChannel` keys | 59 | **64** |
| `ipcMain.handle(` — `ipc.ts` / `index.ts` | 54 / 0 | **58 / 0** |
| `MIGRATIONS.length` | 13 | **14** |
| `sqliteTable(` | 16 | **16** |

**Read the code.** `Phase-3h-Overview.md`'s ground-fact table was measured at `78ef546` and is the
one table in the docs you may trust without re-deriving — and even that, re-run the four gate
commands in §"The baseline" yourself before your first edit.

### 2. There are five pre-existing untracked files that are NOT yours. Do not commit them.

```
?? CLAUDE-PROJECT-MARKER.txt
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3g.0-ReasoningSpend-Findings.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3g.0-ReasoningSpend.md
?? docs/Features/Foundation/Investigations/3f-0-SizeCost/case-C.md
?? docs/Features/Foundation/Investigations/3f-0-SizeCost/case-D.md
```

- `CLAUDE-PROJECT-MARKER.txt` is a 48-byte scratch marker.
- The two `CouncilBrief-3g.0-*` files are a council brief issued 2026-08-07 and its findings —
  **another workstream's**, and the reason this phase is lettered `3h` rather than `3g`.
- The two `case-*.md` files are 231 KB and 808 KB size/cost instrument fixtures from the Phase 3f
  investigation.

**Do not revert, stage, or commit any of them.** Stage **only** the files each task creates or
edits, **by path** — never `git add -A`, never `git commit -a`.

*(`Phase-3h-Overview.md` and `Phase-3h-ExecutionPrompt.md` may also appear untracked if they were
not committed before you started. Leave them alone too unless a finding forces you to amend one, in
which case say so in your report.)*

### 3. ⚠ There is a second, live Chorus on this machine, and this phase MIGRATES A DATABASE AND DELETES ROWS

Two separate installations with two separate databases:

| | Location | Its database |
|---|---|---|
| **The dev app** (what you run) | `electron-vite dev` from the repo | `C:\Users\matth\AppData\Roaming\chorus\chorus.db` |
| **Matthew's installed Chorus** (do not touch) | `%APPDATA%\chorus-app` | `C:\Users\matth\AppData\Roaming\chorus-app\` |

- **Launch the dev app with `_verify/launch.ps1`** (it restores `ComSpec` and rebuilds `PATH` from
  the registry first — the harness strips both) on `--remote-debugging-port=9222`, then drive it
  over CDP. `_verify/` is gitignored (last line of `.gitignore`) and is the reusable harness;
  `_verify/2-1-cdp.js` is a working driver precedent, `_verify/shot.ps1` takes screenshots,
  `_verify/killtree.ps1` kills a process tree.
- **Kill ONLY the dev instance, identified by its command line containing `9222`**, and kill process
  **trees**. **Never** `Stop-Process -Name electron`; **never** `taskkill /IM electron.exe`. Doing so
  destroys Matthew's working instance and his session state.
- If `9222` is already bound when you start, **something else owns it — stop and report.**

**⚠ AND FOR THE DESTRUCTIVE TESTS, USE A THROWAWAY `--user-data-dir`.** `_verify/launch.ps1` as
written launches against the real dev profile. For anything that deletes rows, copy the script,
append a second passthrough argument, and point it at a scratch directory:

```
-ArgumentList 'node_modules/electron-vite/bin/electron-vite.js','dev','--',
  '--remote-debugging-port=9222','--user-data-dir=C:\Users\matth\AppData\Local\Temp\chorus-3h'
```

Seed that directory by copying `chorus.db` (plus `-shm`/`-wal`) from the dev profile. **If you also
need pre-existing credential blobs to decrypt, copy `Local State` beside it** — the OSCrypt key
lives there, and without it every stored credential in the copied database is undecryptable. You do
not need that for anything in this phase; it is noted so you do not lose an hour to it.

**The one test that must run against the REAL dev database is the migration before/after screenshot
pair** (Task 1's highest-value check). Take the "before" screenshot **first**, on the unmigrated
database, and **back up `chorus.db` before you let the migrated build touch it** — v15 is
additive and has no down-migration.

### 4. Two `toHaveLength(64)` assertions guard the channel count, not one

```
src/shared/ipc.test.ts:2858
src/shared/ipc.test.ts:3175
```

**Editing one ships a green suite with a dead tripwire.** That file's own subject
(`src/shared/ipc.ts:225–230`) says why it matters: *"a tally nobody maintains is worse than no tally:
it reads as a check that has been passing."* Both move to **68**, together, in **Task 2**.

### 5. Zod runs in MAIN only — never in the preload

The preload runs under a CSP that makes Zod throw `EvalError`, and the failure mode is silent: events
are dropped with no error surfaced. Every new channel validates in `src/main/ipc.ts`. The preload
(`src/preload/index.ts`) is a thin `ipcRenderer.invoke` passthrough and nothing more.

### 6. This phase spends `$0.00`

Nothing here calls a provider. **A council run would breach the envelope.** If you find yourself
wanting one, you have left the phase.

---

## Ground yourself first — read these before writing anything

| File | Why |
|---|---|
| `docs/Features/Foundation/Tasks/Phase-3h-Overview.md` | **Your contract.** The verified ground facts, **D120–D125**, the purity contract, the hazards, the gates, and the four corrections to earlier plan numbers |
| `CLAUDE.md` | The standing rules — sessions live in main, all IPC Zod-validated in main, **IPC payloads must be plain objects (D14)**, ask before adding a dependency |
| `docs/Features/Foundation/roadmap.md` | §4 the CR mechanism · §6 **Decisions** table (append D120–D125 at the end) · §7 **Phases** (add the 3h entry after the Phase 3f entry at line ~1172) · *"How to run the next step"* (line ~1319). **Its numbers are stale — see §1 above** |
| `docs/design/v2/Chorus Workspace.dc.html` | The rail's geometry and tokens (D73: the mock is the authority for layout). **It draws no lifecycle affordance and no disclosure — you are designing those, within D122's rules** |

**Code you must read before editing it:**

| What | Where |
|---|---|
| The migration array, its runner, and v13/v14's nullable rulings | `src/main/services/storage.ts:121–590`, runner `:2093–2111`, v13 comment `:550–567`, v14 body `:588–589` |
| The `projects` DDL and the Drizzle mirror (D7, hand-synced) | `storage.ts:122–127` · `src/main/db/schema.ts:15–24` |
| Every FK that constrains the delete order | `src/main/db/schema.ts:26–31` (pane_layouts), `:50–52` (sessions), `:93–100` (worktrees — **`session_id` is why worktrees precede sessions**) |
| The soft pointers SQLite will not cascade | `src/main/db/schema.ts:195–280` (dispatches, attention_spans), `:483–533` (council_runs, council_messages) |
| The transaction shapes to copy | `storage.ts:1010–1021` (`deleteProviderConfig`) · `storage.ts:1958–1963` (`deleteCouncilRun`) |
| `getOrCreateProject` and its `root_path` UNIQUE key | `storage.ts:612–644` |
| The boot project resolution + the seed that must not reactivate | `src/main/index.ts:429–434` (the call is at **`:432`**) |
| The four project handlers | `src/main/ipc.ts:2972` (add) · `:2984` (list) · `:3000` (select) · `:3022` (update) |
| `requireProject`, and the three call sites the new guard joins | `src/main/ipc.ts:462–466` · `:871` · `:1200` · **`:2407` `council:start`, which has NO project guard today** |
| The wire schemas | `src/shared/ipc.ts:1824–1841` (`projectSchema`) · `:1872–1874` (`projectsListSchema`) · `:1900–1911` (update) |
| Both index-cycle colour functions | `src/renderer/src/projectChip.ts:30–32` **and `:45–50`** |
| Their call sites | `ProjectRail.vue:173` · `ProjectSettingsView.vue:46` (the `findIndex`) and `:58` |
| The rail: the v-for, the sibling-gear pattern, the collapse, the footer | `ProjectRail.vue:159`, `:182–211`, `:110–124`, `:224–325`; width `208px` at `:331` |
| The settings screen and its permanent-loading branch | `ProjectSettingsView.vue` — the branch is at **`:243`** |
| The restore engine's private pending map | `src/main/services/sessionManager.ts:154`, `:229`, `:305`, `:351`; `kill` at `:369` |
| The renderer's view enum | `src/renderer/src/App.vue:172` |
| The shared-sentence precedent and its stated reason | `src/shared/councilDocket.ts:9–12`, `:25–31` |
| The palette's project loop | `src/renderer/src/palette/commands.ts:62–71`; its fixture `src/renderer/src/palette/commands.test.ts:32–66` |

**Git checks to run before you touch anything:**

```bash
git branch --show-current && git log --oneline -1 && git status --porcelain
```

Expected: `main` · `78ef546 Release 0.1.2 …` · the five `??` lines from §2 (plus the two
`Phase-3h-*.md` files if they were not committed). **If anything is modified rather than untracked,
stop and report** — something changed between this prompt being written and you starting.

---

## The baseline, measured 2026-08-07 at `78ef546`

Re-run all of these **before your first edit**. Every one is runnable as written from the repo root.

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

Expected: exit 0 · **`Test Files 34 passed (34)` · `Tests 1219 passed (1219)`** ·
`G4 secret-grep: clean (6 patterns over src/, scripts/, _verify/, package.json, root configs)`.

```bash
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8').split(/\r?\n/);const a=s.findIndex(l=>l.includes('export const IpcChannel = {'));let b=a;for(let i=a+1;i<s.length;i++){if(/^\} as const/.test(s[i])){b=i;break}}let n=0;for(let i=a+1;i<b;i++)if(/^\s{2}[A-Za-z][A-Za-z0-9_]*:\s*'/.test(s[i]))n++;console.log('IpcChannel keys:',n)"
```

Expected: **`IpcChannel keys: 64`**.

```bash
node -e "const s=require('fs').readFileSync('src/main/services/storage.ts','utf8').split(/\r?\n/);const a=s.findIndex(l=>l.includes('const MIGRATIONS: string[] = ['));let b=a;for(let i=a+1;i<s.length;i++){if(/^\]/.test(s[i])){b=i;break}}let n=0;for(let i=a+1;i<b;i++)if(/^\s{2}\`/.test(s[i]))n++;console.log('MIGRATIONS.length:',n)"
```

Expected: **`MIGRATIONS.length: 14`** — so **v15 is the next free version**. If it prints anything
else, **STOP AND REPORT**; do not renumber.

```bash
grep -c "ipcMain.handle(" src/main/ipc.ts src/main/index.ts && grep -c "sqliteTable(" src/main/db/schema.ts && grep -n "toHaveLength(64)" src/shared/ipc.test.ts
```

Expected: `src/main/ipc.ts:58` · `src/main/index.ts:0` · `16` · two lines, **`2858`** and **`3175`**.

| Gate | Baseline | Task 1 | Task 2 | Task 3 |
|---|---|---|---|---|
| vitest | **1219 / 34 files** | rises | rises | rises — **never fewer** |
| `IpcChannel` keys | **64** | **64** | **68** | **68** |
| `ipcMain.handle(` `ipc.ts` / `index.ts` | **58 / 0** | **58 / 0** | **62 / 0** | **62 / 0** |
| `MIGRATIONS.length` | **14** | **15** | **15** | **15** |
| `sqliteTable(` | **16** | **16** | **16** | **16** |
| Runtime dependencies in `package.json` | **7** | **7** | **7** | **7** |

---

## Task 1 — Schema v15, the status vocabulary, and the colour decoupling

**Nothing user-visible ships in this task.** Its entire claim is *"the database now carries three new
facts and the app looks exactly as it did."* That claim is checkable, which is why it is a task.

### 1.1 Migration v15

Assert `MIGRATIONS.length + 1 === 15` first. Append **one** entry to the array in
`src/main/services/storage.ts`:

```sql
ALTER TABLE projects ADD COLUMN status     TEXT    NOT NULL DEFAULT 'active';
ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN color_seed INTEGER NOT NULL DEFAULT 0;
UPDATE projects SET sort_order = (SELECT COUNT(*) FROM projects p2
  WHERE p2.created_at < projects.created_at
     OR (p2.created_at = projects.created_at AND p2.id < projects.id));
UPDATE projects SET color_seed = sort_order;
CREATE INDEX projects_sort ON projects (sort_order);
```

The comment above it must state, in the house voice:

- **Why `NOT NULL DEFAULT` deliberately inverts v13's nullable ruling.** v13's `color` is nullable
  because NULL *means* "no choice has been made" (`storage.ts:553–560`). **None of these three has
  such a meaning** — every project has a status, a position and a seed the moment the column exists.
- **Why there is no `CHECK` on `status`** — the Zod enum on the boundary is the authority, matching
  `sessions.status`, `worktrees.status` and `auth_mode`.
- **Why there is no `UNIQUE` on `sort_order`** — a reorder passes through transient duplicates inside
  its own transaction, and SQLite unique indexes are not deferrable.
- **⚠ The honest caveat.** `created_at` is an ISO string (`storage.ts:638`) and **ordering is
  unspecified for two rows written in the same millisecond**. The back-fill breaks that tie on
  `id ASC`, so on such a database **one project's chip can change colour once, at migration time, and
  never again.** **Do not write "nothing changes visually" unconditionally.**

**Mirror the three columns into `src/main/db/schema.ts:15–24` in the same commit.** D7 keeps the
hand-rolled DDL and Drizzle synchronised **by hand only** — a column in one and not the other
typechecks clean and fails on the first query.

### 1.2 The status vocabulary

- `ProjectStatus = 'active' | 'hidden' | 'archived'` — **one ordered vocabulary, not two booleans**
  (D120). Two booleans express four states, one of which is nonsense.
- `projectSchema` (`src/shared/ipc.ts:1824–1841`) gains **`status`** and **`color_seed`**, both
  **required and non-nullable** — a deliberate deviation from the required-nullable house rule,
  because after v15 every row has both and nullable would encode an unreachable state. Say so in the
  schema comment.
- **`sort_order` does not cross the wire.** Main returns the list ordered; the renderer sends the
  order it wants. Shipping the number creates a second authority on position.
- Update `toProjectRecord` / `toWireProject` and the `ProjectRecord` type accordingly.

### 1.3 The resurrection problem, and the boot seed

- `getOrCreateProject` (`storage.ts:612–644`) is keyed on **`UNIQUE root_path`**, so re-adding an
  archived project's folder returns the archived row. Picking the folder is an unambiguous statement
  of intent, so it **reactivates — loudly**: return `{ project, reactivatedFrom: ProjectStatus |
  null }`, and let `project:add` (`src/main/ipc.ts:2972`) carry `reactivated_from` so the renderer can say
  *"Unarchived Chorus — it was in your archive."* **Reactivating relaunches nothing.**
- **⚠ THE BOOT SEED MUST NOT USE THAT PATH.** `src/main/index.ts:432` calls
  `getOrCreateProject(DEV_WORKING_DIR)`. Add **`getProjectByRootPath`** and read first, or archiving
  your dev project and restarting **silently un-archives it**.

### 1.4 The colour decoupling — the reason this task is first

`chipColorValue(color, index)` (`projectChip.ts:30–32`) cycles `SPINE_VARS` **by array index** for
projects with `color === null`. **`resolveChipHex(color, index)` (`:45–50`) does the same** and is
what the settings picker opens on, fed by `projectIndex` (`ProjectSettingsView.vue:46`, consumed
`:58`).

**The moment the rail renders a partition or a reorder, `i` is an index into a sub-array and every
pre-v13 project repaints.**

- Rename the parameter to **`seed`** in **both** functions. **Leave the bodies and the
  custom-property names untouched** — `projectChip.ts:19–21` forbids duplicating the hex; `main.css`
  stays the authority.
- Feed **`p.color_seed`** at `ProjectRail.vue:173` and `ProjectSettingsView.vue:58`.
- **Delete the `projectIndex` computed entirely.** Leaving it as a dead fallback leaves a second
  answer to "what colour is this project" alive in the very file whose docstring exists because two
  surfaces once disagreed.
- Add `src/renderer/src/projectChip.test.ts` — it has none today. Cover the cycle, the stored-colour
  short-circuit, and `seed` values beyond the array length.

### 1.5 Task 1 verification

- Gates: typecheck 0 · vitest **> 1219, 34+ files** · `grep:secrets` clean.
- `IpcChannel` **still 64**; `ipcMain.handle(` **still 58 / 0**; `sqliteTable(` **still 16**;
  `MIGRATIONS.length` **15**.
- **G2 — the highest-value check in the whole phase.** On the **real dev database**: screenshot the
  rail **before** the migration, back up `chorus.db`, launch the migrated build, screenshot again.
  **Order identical and every chip colour pixel-identical** — or, if the same-millisecond tie-break
  moved one, **say which project and why**, and confirm it is stable across a second launch.

---

## Task 2 — The lifecycle, end to end

**This is the task D125 exists for.** All four channels, both tripwire edits, the whole declaration,
in one place.

### 2.1 The four channels (D125 — `IpcChannel` 64 → 68, `ipcMain.handle(` 58 → 62 / 0)

Add the exception comment to the `IpcChannel` map in the shape the Docket's block already uses
(`src/shared/ipc.ts:219–241`) — **stating the before and after numbers**.

| Channel | Payload | Why it cannot ride an existing channel |
|---|---|---|
| `project:set-status` | `{ project_id, status }` | **`project:update` (`src/main/ipc.ts:3022`) is a total overwrite sent by a form**, and a status change **kills PTY processes**. Folding a process-killing side effect into the identity-save path puts every future settings edit one typo away from stopping the user's agents. |
| `project:reorder` | `{ ordered_ids: string[] }` | **Every project id in the new order**, not a moved pair. Main validates it is a **full permutation of `listProjects()`'s actual ids** and refuses otherwise. |
| `project:delete` | `{ project_id, typed_name }` | The only irreversible verb. A destructive verb sharing a handler with a reversible one is how the wrong branch gets taken. |
| `project:impact` | `{ project_id }` → counts | **Cannot ride `project:list`**: the transcript-turn count scans `council_messages` through `council_runs`, and `project:list` runs at boot and on every `store.load()`. **Cannot be a `dry_run` flag on `project:delete`**: a dropped boolean on a destructive channel deletes data. |

**⚠ Validate against real ids, not a uuid predicate.** A well-formed uuid that is not a project is
still not a permutation. *(For the record: project ids **are** uuids — `randomUUID()` at
`storage.ts:622`, `z.uuid()` at `src/shared/ipc.ts:1825`. `'legacy-credentialed'` is a **launch-profile**
sentinel, `src/main/services/launchProfiles.ts:55`, and has nothing to do with projects. If an earlier note
told you non-uuid project ids exist, it was wrong.)*

**`project:reorder`'s channel, schema and handler land here with NO renderer caller** — the
`deleteCouncilRun` pattern (`storage.ts:1955–1956`). Task 3 wires it.

**Both `toHaveLength(64)` assertions become `toHaveLength(68)`, together** — `ipc.test.ts:2858` and
`:3175`. Add an assertion that the four new channel strings are present and unique.

### 2.2 `deleteProject(id, successorActiveId)` — one transaction, order load-bearing

The `deleteProviderConfig` shape (`storage.ts:1010–1021`) scaled up:

1. `council_messages` (via a `council_runs` subquery on `project_id`)
2. `council_runs`
3. `attention_spans`
4. `dispatches`
5. **`worktrees` — MUST precede sessions** (`worktrees.session_id` REFERENCES `sessions.id`,
   `src/main/db/schema.ts:96–100`). Any other order throws `SQLITE_CONSTRAINT_FOREIGNKEY`.
6. `sessions`
7. `pane_layouts`
8. the two settings keys `view_state:<id>` and `last_launch_profile:<id>`
9. `active_project_id` — only when it names this project
10. `projects`

- **Steps 1–4 and 8 are soft pointers with no cascade.**
- **Step 8 is the first `tx.delete(settings)` in the codebase** — there are zero today — and
  **nothing enumerates settings keys**, so a missed key is unreachable forever by any surface the app
  has. **Steps 3 and 4 are the first deletes `attention_spans` and `dispatches` have ever had.**
- **Return the accumulated `changes`** — what was actually deleted, not a re-read prediction.

**Guards in main, before any transaction** — the count-and-refuse posture
(`countCredentialProfilesForProvider`, `countLaunchProfilesForProvider`), never reverse-engineering a
constraint throw:

- **Refuse if any session of the project is live.** The FK would **not** catch this: the row deletes
  cleanly and the PTY is orphaned.
- **Exact-equality typed-name check** (D123).
- **Permutation check** for reorder.
- New **`requireLaunchableProject`**, applied to `session:launch` (`src/main/ipc.ts:869`),
  `session:launch-context` (`:1196`) **and `council:start` (`:2407`, which has no project guard at
  all today)**.

### 2.3 Archive semantics

- **Kill the live PTYs, then heal every `'running'` row of that project to `'exited'`.** Not
  redundant: `kill()` (`sessionManager.ts:369`) is asynchronous and the exit event may never land,
  leaving a row that relaunches on unarchive.
- **Clear `restorePending` for the project** — add a one-line `SessionManager.clearRestorePending`.
  The map is private (`sessionManager.ts:154`) with no public clear, and a mid-restore archive
  otherwise strands a spinner that never concludes (`TerminalPane.vue:309` reads the flag).
- **Reassign `active_project_id`** via a pure, unit-testable **`computeSuccessorActiveId`**, and
  **retitle the window**. `project:select` (`src/main/ipc.ts:3004`) and `project:update` (`:3036`) are the
  only two places that set the title today; a third path that forgets leaves the titlebar naming a
  project you archived.
- **Boot resolution skips archived projects** (`src/main/index.ts:429–434`). **`project:select` throws on
  one.** **The palette filters archived out but KEEPS hidden** (`src/renderer/src/palette/commands.ts:62–71`) — the
  fast way back to a project you tucked away.
- **`hidden` does none of this** (D120): sessions keep running and still restore at boot.

### 2.4 The shared, testable sentence

New **`src/shared/projectLifecycle.ts`** — `describeProjectDeletion`, `describeArchive`,
`describeHide`. Restate the `councilDocket.ts:9–12` reason in the file header: interpolating the one
sentence that has to be right into a `.vue` template makes it *"the one sentence nothing checks."*

Contract, each clause unit-tested:

- **Name the project.**
- **State every non-zero count with correct plurals** — sessions, worktrees, council runs, transcript
  turns.
- **Omit zero clauses rather than printing "0 sessions"** (D76).
- **State what survives, in its own sentence** — the folder on disk (D121), and the worktree folders
  Chorus **stops tracking** (D124). `worktrees.project_id` is `NOT NULL REFERENCES projects(id)`
  (`src/main/db/schema.ts:93–95`) with FKs enforced, so a detached row cannot outlive its project and the
  panel (keyed on `project_id`, `storage.ts:919`) could never surface one — the rows go, the
  directories and branches stay.
- **State irreversibility.**

### 2.5 The surfaces

- **Lifecycle actions live in `ProjectSettingsView.vue`, not the rail.** The gear is already an
  absolutely-positioned **sibling** because button-in-button is invalid HTML
  (`ProjectRail.vue:182–187`); a second and third sibling at 208px (`:331`) is unworkable; there is
  no popover primitive to reuse.
- **The rail gains a collapsed disclosure at its foot** — `Archived (3)` — expanding **in place**
  with the rows dimmed (D122). **Nothing silently vanishes.**
- **Partition rule: visible when `status === 'active' || p.id === activeId`.** The second clause is
  load-bearing — a hidden project may be the active one, and without it you would be staring at a
  workspace whose project is not in the rail. Put `partitionRail` and `tuckedLabel` in the new pure
  module `src/renderer/src/projectRail.ts` (`.ts` so Vitest reaches it — the `projectChip.ts`
  precedent; the environment is `node` and there are **no `.vue` tests in this repo**).
- **The tucked rows carry only `Unhide` / `Unarchive`. Delete is never offered from the rail** — one
  destructive door, behind the typed name.
- **Delete confirmation states the counts up front** (D123/D109) and names what survives.
- **⚠ Deleting the ACTIVE project:** the renderer must set `activeView = 'workspace'`
  (`App.vue:172`) **before** reloading, or it lands on `ProjectSettingsView.vue:243`'s permanent
  `Loading project…` branch.

### 2.6 Task 2 verification

- Gates green; **`IpcChannel` 68**, **`ipcMain.handle(` 62 / 0**, `sqliteTable(` **16**,
  `MIGRATIONS.length` **15**.
- `grep -n "toHaveLength(68)" src/shared/ipc.test.ts` → **two lines**.
- **G2, against a throwaway `--user-data-dir` (§3):**
  1. **Archive actually kills PTYs**, and the healed rows **do not relaunch on unarchive**.
  2. **The FK ordering in `deleteProject`** — reproduce with a project that has a session in a **new
     worktree** plus a council run. Any wrong order throws `SQLITE_CONSTRAINT_FOREIGNKEY`.
  3. **Orphan-settings check by hand:** `SELECT key FROM settings WHERE key LIKE '%<deleted-id>%'`
     must return **zero rows**.
  4. **`getOrCreateProject` reactivation, and the boot seed NOT reactivating** — needs **two
     launches** with an archived `DEV_WORKING_DIR` project.
  5. An archived project **cannot be selected, launched into, or councilled**; a **hidden** one still
     appears in the palette and its sessions still restore.
  6. The delete confirmation's counts **read from a real database**, with correct plurals and no zero
     clauses.

---

## Task 3 — Drag and Alt+Arrow reorder

**Built from scratch, with no dependency.** Do not add one; do not ask to.

- **Pointer Events, not HTML5 DnD** — which drags a ghost label and needs `preventDefault` in three
  handlers.
- **A 14px grab handle, a sibling rather than a child.** The row itself is the click target for
  `select` (`ProjectRail.vue:159–180`), and a drag threshold on the row makes **every project switch
  a potential accidental reorder**.
- One `getBoundingClientRect` snapshot at `pointerdown`. **4px threshold.**
- **Transforms only — no DOM reordering during the drag.**
- **Auto-scroll within 24px of either edge.**
- **Escape and `pointercancel` abort with no write.**
- `prefers-reduced-motion` honoured **on the displaced rows only**.
- **Disabled when the rail is collapsed** (`ProjectRail.vue:110–124`) and **inside the disclosure**.
- **Alt+↑/↓ keyboard fallback ships in this task**, not later. **Focus must survive it.**
- Pure helpers `moveItem` and `visibleIndexToFullIndex` go in `projectRail.ts` and are unit-tested;
  the component holds only the pointer bookkeeping.

**⚠ D14 — structured clone.** `ordered_ids` built from a Pinia array is a **Vue Proxy**, and `invoke`
throws *"An object could not be cloned"* with **no compile-time signal**. **Build a fresh
`string[]`** — e.g. `projects.map((p) => p.id)` into a plain array, verified at runtime, not assumed
from the types.

### Task 3 verification

- Gates green; **still 68 channels / 62 handlers / 0 in `src/main/index.ts`**; `MIGRATIONS.length` **15**.
- **G2:** the **whole drag interaction** — threshold, auto-scroll at **both** edges, Escape-cancel
  with **no write** (confirm the order is unchanged after a restart), **order survives restart**,
  **chip colours do not move**, and **focus survives Alt+Arrow**.

---

## Strict non-goals

- **No new table.** `sqliteTable(` stays **16**.
- **No second migration.** `MIGRATIONS.length` **15** and stops.
- **No fifth channel.** 68 and stops. No payload reshape beyond `projectSchema`'s two new fields.
- **No dependency added.** Runtime dependencies stay at **7**.
- **Nothing is written outside the database** (D121) — no `fs` write, no `git worktree remove`, no
  folder deletion, in any task.
- **No council run.** The envelope is `$0.00`.
- **Do not touch** `councilCore.ts`, `councilService.ts`, `apiSession.ts`, `vault*`, `adapters/`, or
  the scrubber. A diff that reaches them has left this phase.
- **Do not fix the attention-reporter orphan.** `attention_spans.project_id` is a soft pointer and
  `src/main/ipc.ts:2920` is deliberately unguarded and fire-and-forget, so main will keep writing spans for a
  deleted project. **Record it as a finding; do not widen the phase to close it.**
- **Do not commit the five pre-existing untracked files** (§2).
- **Do not push or open a PR unless explicitly asked.**

---

## Required workflow

1. **Coordinator pattern.** You own the outcome. Ground yourself in the documents above **before**
   editing anything. This repo has **no `.codex/workflows/subagents/` kit** — do not go looking for
   one.
2. **The tasks are strictly ordered, and the order is not a preference.** Task 2 cannot partition the
   list before Task 1 decouples the colour, or hiding one project repaints every legacy project
   below it. **Do not start Task 2 until Task 1's before/after screenshot pair exists.**
3. **Re-run the baseline commands before your first edit.** If any number differs from §"The
   baseline", **stop and report** rather than proceeding on a stale assumption.
4. **One intentional, narrated commit per task (G3)**, in the house style: a plain-English title a
   non-technical reader understands, then the technical detail. **Stage by path.**
5. **Verify at runtime, not only at compile time.** Vitest is `environment: 'node'`, **cannot import
   `storage.ts`** (better-sqlite3 is built for the Electron ABI — confirmed at `78ef546`: a plain
   `node` `new Database(':memory:')` still fails to load the binding), and there are **no `.vue`
   tests**. Everything this phase does to the database and to the rail is reachable **only** through
   the running app.
6. **Record D120–D125 and the Phase 3h entry in the roadmap** as part of the final commit — the
   Decisions table (§6, after D119) and §7 (after the Phase 3f entry, ~line 1172). **Include the
   corrected counts**, since the roadmap's own are ten commits stale.

---

## Verification commands — runnable as written from the repo root

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

Baseline **1219 / 34 files**; the rule is **"never fewer"**.

```bash
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8').split(/\r?\n/);const a=s.findIndex(l=>l.includes('export const IpcChannel = {'));let b=a;for(let i=a+1;i<s.length;i++){if(/^\} as const/.test(s[i])){b=i;break}}let n=0;for(let i=a+1;i<b;i++)if(/^\s{2}[A-Za-z][A-Za-z0-9_]*:\s*'/.test(s[i]))n++;console.log('IpcChannel keys:',n)"
```

Expected **64** after Task 1, **68** after Tasks 2 and 3.

```bash
grep -c "ipcMain.handle(" src/main/ipc.ts src/main/index.ts
```

Expected `src/main/ipc.ts:58` / `src/main/index.ts:0` after Task 1; **`62` / `0`** after Tasks 2 and 3.

```bash
node -e "const s=require('fs').readFileSync('src/main/services/storage.ts','utf8').split(/\r?\n/);const a=s.findIndex(l=>l.includes('const MIGRATIONS: string[] = ['));let b=a;for(let i=a+1;i<s.length;i++){if(/^\]/.test(s[i])){b=i;break}}let n=0;for(let i=a+1;i<b;i++)if(/^\s{2}\`/.test(s[i]))n++;console.log('MIGRATIONS.length:',n)"
```

Expected **14** before Task 1, **15** after — and **15** for the rest of the phase.

```bash
grep -c "sqliteTable(" src/main/db/schema.ts
```

Expected **16**, every task.

```bash
grep -n "toHaveLength(6[0-9])" src/shared/ipc.test.ts
```

Expected **two lines**: `2858` and `3175`, reading **64** before Task 2 and **68** after. **One line
at 68 and one at 64 is a failed gate, not a rounding error.**

```bash
git status --porcelain -- package.json package-lock.json
```

Expected: **empty**. No dependency was added.

```bash
git status --porcelain
```

Expected: your task's files, **plus exactly the five pre-existing `??` lines from §2, untouched**.

---

## Failure honesty clause

**If a verification command fails for an unrelated environment reason** — a missing tool, port 9222
already bound, a native-module rebuild, the harness stripping `PATH` — **capture the exact output,
explain what happened, and do NOT claim success.** Report the gate as **failed-with-explanation**.

The same applies to the runtime checks. **A G2 obligation you could not reach is a finding**, and it
belongs in your report with the reason and with what it leaves unproven. **A runtime claim recorded
without having run it is the worst outcome this phase can produce** — this project has been burned by
exactly that before, which is why G2 exists as a separate gate from G1.

**Two things are STOP-AND-REPORT, not work-arounds:**

1. **`MIGRATIONS.length` is not 14 when you start.** Do not renumber. Report and wait.
2. **The before/after rail screenshots do not match**, beyond the single same-millisecond tie-break
   the migration comment predicts. That is the colour decoupling having failed, and every subsequent
   task builds on it.

---

## Final reporting requirements

End with a structured report containing **all** of the following:

1. **Status** — exactly one of **`DONE`** / **`DONE_WITH_CONCERNS`** / **`NEEDS_CONTEXT`** /
   **`BLOCKED`**.
2. **Files changed**, per task, every path with a one-line reason. **Expected new files:**
   `src/shared/projectLifecycle.ts` · `src/renderer/src/projectRail.ts` ·
   `src/renderer/src/projectChip.test.ts` · `src/renderer/src/projectRail.test.ts` ·
   `src/shared/projectLifecycle.test.ts` · a main-side test for `computeSuccessorActiveId` · plus
   `roadmap.md` edited.
3. **Build results** — `typecheck`, `vitest` (**the actual counts, before and after**),
   `grep:secrets`, each with what you actually observed.
4. **The tally table** — `IpcChannel`, `ipcMain.handle(` in both files, `sqliteTable(`,
   `MIGRATIONS.length`, and runtime dependency count, **at the end of each of the three tasks**,
   against the expected values in §"The baseline".
5. **Both tripwire lines**, quoted, showing they moved **together**.
6. **The migration evidence** — the before/after rail screenshots, and **an explicit statement about
   chip colours**: identical, or *"project X moved from violet to sand because its `created_at` ties
   with project Y to the millisecond and the back-fill breaks that tie on `id ASC`"*. **Never
   "nothing changed" unconditionally.**
7. **Runtime results (G2)**, item by item, for all six of Task 2's checks and all of Task 3's,
   including the **exact `SELECT key FROM settings WHERE key LIKE '%<id>%'` output**.
8. **Non-goals confirmation** — explicitly: no new table, no second migration, no fifth channel, no
   dependency added, nothing written outside the database, no council run, no council/vault/adapter
   file touched, the five pre-existing untracked files still untracked and unmodified.
9. **D120–D125 as recorded** — the roadmap lines you added, and the Phase 3h §7 entry.
10. **Findings** — anything you hit that is true and out of scope. **The attention-reporter orphan
    belongs here** if you confirmed it. Give each one a number continuing the roadmap's F-series, and
    say what it blocks.
11. **Residual risks and anything still unverified**, with what each blocks downstream.
12. **Final `git status --porcelain` and `git log --oneline -4`**, verbatim.

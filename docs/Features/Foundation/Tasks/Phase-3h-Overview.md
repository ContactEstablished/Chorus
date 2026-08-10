# Phase 3h — Project Lifecycle & Rail Order — Task Overview

**Kicked off 2026-08-07** against the verified codebase at **`78ef546`** *("Release 0.1.2 — the
council-answers and reinstall-safety build")*. **Every number, path and line reference in this
document was re-run at that HEAD while authoring it.** Nothing is inherited from the roadmap.

## Why this phase exists

Chorus's project rail can **add** and **select**, and nothing else. There is no way to retire a
project you have finished with, tuck one out of sight, remove one you added by mistake, or change
the order they appear in. The list is ordered by `created_at ASC`
(`src/main/services/storage.ts:646–649`) and every row is always rendered
(`src/renderer/src/components/ProjectRail.vue:159`).

Matthew wants all four capabilities. They are one phase because they share a migration, a status
vocabulary and a colour source — and because the first thing any of them does to the rail (partition
it, or reorder it) **silently repaints every project created before migration v13**, for reasons set
out under *The colour decoupling* below. Shipping them separately would mean shipping that repaint.

## ⚠ Why this is `3h` and not `3g`

There is **no Phase 3g in the roadmap**, and this document does not create one. The letter is taken
because `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3g.0-ReasoningSpend.md` and its
`-Findings.md` exist (issued 2026-08-07, currently **untracked**), which claims `3g` for the
reasoning-token spend work whether or not it has a roadmap entry yet. **`3h` is the next free
letter.** Recorded here so a later reader does not read the gap as a lost phase.

---

## ⚠ The roadmap is stale, and this phase is authored against the code

The roadmap's last decision is **D119, accepted 2026-08-04**. **Ten commits have landed since**
(`9aa0596` … `78ef546`, 2026-08-04 → 2026-08-07). Its most recent measured counts — *"2026-08-01 at
`5ba3b98` + an uncommitted working tree"* — are all wrong now:

| Fact | Roadmap says (2026-08-01) | **Truth at `78ef546`** |
|---|---|---|
| `IpcChannel` keys | 59 | **64** |
| `ipcMain.handle(` — `ipc.ts` / `index.ts` | 54 / 0 | **58 / 0** |
| `MIGRATIONS.length` | 13 | **14** |
| `sqliteTable(` | 16 | **16** *(unchanged)* |

**Read the code, not the roadmap, for anything this phase touches.** The roadmap's §5 pass notes say
so themselves: *"facts not touched keep their earlier dates and are NOT re-asserted."*

## Verified ground facts — checked 2026-08-07 at `78ef546`

| Fact | Where | Value |
|---|---|---|
| Projects listed in creation order | `src/main/services/storage.ts:646–649` | `.orderBy(asc(projects.createdAt))` — every row, always |
| The rail renders that list unfiltered | `src/renderer/src/components/ProjectRail.vue:159` | `v-for="(p, i) in store.projects"` |
| The chip colour is drawn from the **loop index** | `ProjectRail.vue:173` | `chipColorValue(p.color, i)` |
| The index cycle itself | `src/renderer/src/projectChip.ts:30–32` | `chipColorValue(color, index)` → `color ?? var(SPINE_VARS[index % 3])` |
| **A SECOND index call site** | `projectChip.ts:45–50` | `resolveChipHex(color, index)` — same cycle, resolved to hex for `<input type="color">` |
| …fed by a `findIndex` over the store | `src/renderer/src/views/ProjectSettingsView.vue:46`, consumed at `:58` | `projectIndex` → `resolveChipHex(…, Math.max(projectIndex, 0))` |
| `MIGRATIONS` array | `storage.ts:121–590` | **14 entries**; v14 body at `:588–589`; next free version is **v15** |
| Migration runner | `storage.ts:2093–2111` | applies `MIGRATIONS[version-1]` in a transaction per version |
| v13's nullable ruling (the one v15 deliberately inverts) | `storage.ts:550–567` | *"NULL is read by the rail as 'no choice has been made'"* |
| Drizzle `projects` table (hand-synced, D7) | `src/main/db/schema.ts:15–24` | `id · name · rootPath(unique) · createdAt · color · description` |
| `projects` DDL | `storage.ts:122–127` | `root_path TEXT NOT NULL UNIQUE`, `created_at TEXT NOT NULL` |
| `created_at` is an ISO string | `storage.ts:638` | `new Date().toISOString()` |
| `getOrCreateProject` is keyed on `root_path` | `storage.ts:612–644` | returns the existing row for a re-added folder, whatever its state |
| The boot seed goes through that same path | `src/main/index.ts:429–434` | `getOrCreateProject(DEV_WORKING_DIR)` at **`:432`** |
| `IpcChannel` map | `src/shared/ipc.ts:14–321` | **64 keys** |
| `ipcMain.handle(` | `src/main/ipc.ts` / `src/main/index.ts` | **58 / 0** |
| `requireProject` — the guard that exists | `src/main/ipc.ts:462–466` | throws `Unknown project_id` |
| …applied at `session:launch` / `session:launch-context` | `src/main/ipc.ts:871` / `:1200` | handlers at `:869` / `:1196` |
| **`council:start` has NO project guard at all** | `src/main/ipc.ts:2407–2411` | parses, then calls `council.start({ projectId, … })` directly |
| **`attention:report` has no guard either, deliberately** | `src/main/ipc.ts:2920–2927` | *"a throw here would break the renderer's fire-and-forget send"* |
| `projectSchema` on the wire | `src/shared/ipc.ts:1824–1841` | `id: z.uuid()` · `root_path` · `color` nullable · `description` nullable |
| `projectsListSchema` adds the list-only fields | `src/shared/ipc.ts:1872–1874` | `.extend({ active, sessionCount })` |
| The transaction shape to scale up | `storage.ts:1010–1021` | `deleteProviderConfig` — three deletes, one `this.d.transaction` |
| The soft-pointer purge precedent | `storage.ts:1958–1963` | `deleteCouncilRun` — messages then run, one transaction |
| **No `delete(settings)` exists anywhere** | `storage.ts` | zero hits; `deleteProject` would be the first |
| **Nothing ever deletes `attention_spans` or `dispatches`** | `storage.ts` | zero deletes on either table |
| `sessions.project_id` → `projects.id`, NOT NULL | `src/main/db/schema.ts:50–52` | enforced (F16) |
| `worktrees.project_id` → `projects.id`, NOT NULL | `src/main/db/schema.ts:93–95` | a worktree row **cannot** outlive its project |
| `worktrees.session_id` → `sessions.id`, nullable | `src/main/db/schema.ts:96–100` | **worktrees must be deleted BEFORE sessions** |
| `pane_layouts.project_id` → `projects.id` | `src/main/db/schema.ts:26–31` | enforced |
| `council_runs.project_id` / `council_messages.run_id` | `src/main/db/schema.ts:483–533` | **soft pointers, no `REFERENCES`** — SQLite will not cascade them |
| `dispatches.project_id`, `attention_spans.project_id` | `src/main/db/schema.ts:195–280` | soft pointers, same |
| `launch_profiles` has **no** `project_id` | `src/main/db/schema.ts:377–416` | global; only the `last_launch_profile:<id>` settings pointer is per-project |
| The two per-project settings keys | `storage.ts:1704–1733`, `:1799–1830` | `view_state:<projectId>` · `last_launch_profile:<projectId>` |
| The active-project pointer | `storage.ts:711–722` | settings key `active_project_id` |
| Restore's pending set | `src/main/services/sessionManager.ts:154`, set `:229`, cleared `:305`, read `:351` | `Map<projectId, Set<sessionId>>` — **no public clear** |
| Killing one PTY | `sessionManager.ts:369` | `kill(sessionId)` |
| The shared-sentence precedent | `src/shared/councilDocket.ts` | reason at `:9–12`; `describeRemoval` at `:25–31` |
| Renderer view enum | `src/renderer/src/App.vue:172` | `'workspace' \| 'settings' \| 'project-settings' \| 'council'` |
| The permanent-loading branch | `src/renderer/src/views/ProjectSettingsView.vue:243` | `v-if="!project"` → `Loading project…` |
| Existing index naming | `storage.ts:243`, `:284`, `:517` | `dispatches_open` · `dispatches_open_ledger` · `council_messages_run` |
| Rail width | `ProjectRail.vue:331` | `208px` |
| **Baseline** | — | typecheck **exit 0** · vitest **1219 passed (1219) across 34 files** · `grep:secrets` **clean (6 patterns)** · `IpcChannel` **64** · `ipcMain.handle(` **58 / 0** · `sqliteTable(` **16** · `MIGRATIONS.length` **14** |

### ⚠ Four corrections to the numbers this phase was planned with

Found by re-measuring at `78ef546`. They are recorded rather than quietly fixed, because a plan
number that is wrong once will be re-derived wrong by the next reader.

1. **`ProjectSettingsView.vue`'s `Loading project…` is at `:243`, not `:245`.** It is the landing
   spot of the delete-the-active-project hazard, so a two-line drift matters.
2. **`chipColorValue` is not the only index call site.** `resolveChipHex(color, index)`
   (`projectChip.ts:45–50`) cycles the same `SPINE_VARS` array by index and is what the settings
   screen's colour picker opens on. **The colour decoupling must rename and re-feed BOTH**, or the
   picker keeps opening on a colour the rail no longer draws — which is the exact contradiction
   `projectChip.ts:6–11` was created to end.
3. **`commands.test.ts`'s `ProjectsList` fixture is `populatedCtx()` at `:32–66`**, with the
   twice-broken-by-a-new-field comment at `:34–38` and the `projects` array at `:39–58`.
4. **The "non-uuid project ids exist" hazard is FALSE and must not be carried forward.**
   `'legacy-credentialed'` is `LEGACY_CREDENTIALED_PROFILE_ID` (`src/main/services/launchProfiles.ts:55`) — a
   **launch-profile** sentinel written by migration v10's data migration (`storage.ts:400`). Project
   ids are `randomUUID()` (`storage.ts:622`) and `projectSchema.id` is `z.uuid()`
   (`src/shared/ipc.ts:1825`). **The requirement it was invented to justify still stands, for a better
   reason:** `project:reorder` must validate `ordered_ids` against `listProjects()`'s **actual ids**,
   because a well-formed uuid that is not a project is still not a permutation, and a uuid predicate
   would wave it through.

---

## Decisions settled at kickoff

### D120 — three states, three different amounts of "gone" *(Matthew, 2026-08-07)*

`projects.status` is `'active' | 'hidden' | 'archived'`, and the three differ in what they do to
running work, not merely in what they show:

- **`hidden` is cosmetic.** Out of the main rail list; **sessions keep running and still restore at
  boot**; instantly reversible.
- **`archived` is retired.** **Live sessions are stopped**, the project is **skipped at boot
  restore** and **cannot be launched into**, but **every session row, council run, transcript and
  attention span is kept and readable**.
- **`deleted` is purged and irreversible.**

**⚠ ONE ORDERED VOCABULARY, NOT TWO BOOLEANS.** `is_hidden` + `is_archived` expresses four states,
one of which (hidden-and-archived) is nonsense, and every read site would have to decide what it
means. Free-text column validated by a Zod enum on the boundary — the `sessions.status` /
`worktrees.status` / `auth_mode` convention, and **no `CHECK` constraint**, for the reason v13 gave:
a limit belongs where it can be reported, not where it surfaces as a failed write.

### D121 — delete touches nothing on disk *(Matthew, 2026-08-07)*

**Chorus's own rows only. The user's project folder is never touched.** Nothing in this phase calls
`fs.rm`, `git worktree remove`, or anything else that writes outside the database.

### D122 — hidden and archived projects stay reachable *(Matthew, 2026-08-07)*

A collapsed disclosure at the foot of the rail — `Archived (3)` — expanding **in place** with the
rows dimmed. **Nothing silently vanishes.** A project you cannot find is a project you cannot
un-hide, and the app has no other index of projects.

### D123 — delete requires typing the project name *(Matthew, 2026-08-07)*

And the confirmation **states the counts up front** — D109's rule, at a new surface: the size of what
is about to go is stated **before** the action, and the sentence names **what survives** as well as
what goes.

### D124 — worktree rows are purged; worktree directories are not *(coordinator, 2026-08-07)*

`worktrees.project_id` is `NOT NULL REFERENCES projects(id)` (`src/main/db/schema.ts:93–95`) with FKs enforced
(F16), so **a detached worktree row cannot outlive its project** — and the worktree panel reads
`getWorktreesForProject(projectId)` (`storage.ts:919`), so it could never surface one if it did.
`deleteProject` therefore deletes those rows inside its transaction. **The directories and branches
stay on disk**, and the confirmation **names the count and says Chorus stops tracking them**. This is
D121 applied to the one case where "we deleted the row" and "we deleted your work" could be confused.

### D125 — the channel exception, declared before the code *(coordinator, 2026-08-07)*

Four channels: **`project:set-status`**, **`project:reorder`**, **`project:delete`**,
**`project:impact`**.

- **`IpcChannel` 64 → 68**
- **`ipcMain.handle(` in `src/main/ipc.ts` 58 → 62**; in `src/main/index.ts` **stays 0**
- **`sqliteTable(` stays 16** — no new table
- **`MIGRATIONS.length` 14 → 15** — exactly one migration

**Declared here, before any code lands** — the D74/D80 discipline, which the `IpcChannel` map's own
comment (`src/shared/ipc.ts:225–230`) says exists because *"a tally nobody maintains is worse than no
tally: it reads as a check that has been passing."* **No other task in this phase may add a channel
or reshape a payload.**

Why each channel cannot ride an existing one:

- **`set-status` cannot ride `project:update`.** That handler (`src/main/ipc.ts:3022–3039`) is a **total
  overwrite sent by a form**, and a status change **kills PTY processes**. Folding a
  process-killing side effect into the identity-save path puts every future settings edit one typo
  away from stopping the user's agents.
- **`impact` cannot ride `project:list`.** The transcript-turn count scans `council_messages`
  through `council_runs`, and `project:list` runs at boot and on every `store.load()`. **Nor may it
  be a `dry_run` flag on `project:delete`** — a dropped boolean on a destructive channel deletes
  data.
- **`reorder` takes `ordered_ids` — every project id in the new order**, not a moved pair. Main
  validates it is a full permutation of `listProjects()`'s ids and refuses otherwise (G4).
- **`delete` is its own channel** because it is the only irreversible one, and a destructive verb
  sharing a handler with a reversible one is how the wrong branch gets taken.

---

## The design the tasks implement

### Migration v15 — one entry, one transaction

**Pre-flight: assert `MIGRATIONS.length + 1 === 15` and STOP on divergence** rather than renumbering
— the roadmap's standing check, and the one that caught `v13` being spent under Phase 6.

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

- **`NOT NULL DEFAULT` is the deliberate inverse of v13's nullable ruling, and the comment must say
  why.** v13's `color` is nullable because NULL *means* "no choice has been made"
  (`storage.ts:553–560`). **None of these three has such a meaning**: every project has a status, a
  position and a seed the moment the column exists.
- **No `CHECK` on `status`** — the Zod enum on the boundary is the authority (D120).
- **No `UNIQUE` on `sort_order`** — a reorder passes through transient duplicates inside its own
  transaction, and SQLite unique indexes are not deferrable.
- **Mirror into `src/main/db/schema.ts:15–24` in the same commit.** D7 keeps the hand-rolled DDL and
  Drizzle synchronised **by hand only**: a column in one and not the other typechecks clean and
  fails on the first query.
- Index name follows the house convention (`storage.ts:243`, `:284`, `:517`).

**⚠ The honest caveat that belongs in the migration comment.** `created_at` is an ISO string
(`storage.ts:638`) and today's ordering is **unspecified for two rows written in the same
millisecond**. The back-fill breaks that tie on `id ASC`, so on such a database **one project's chip
can change colour once, at migration time, and never again**. Do not write *"nothing changes
visually"* unconditionally.

### The colour decoupling — must land first

`chipColorValue(color, index)` cycles `SPINE_VARS` **by array index** for projects with
`color === null`, and `resolveChipHex(color, index)` does the same for the settings picker, fed by a
`findIndex` over the store. **The moment the rail renders a partition or a reorder, `i` is an index
into a sub-array and every legacy project repaints.**

- Rename the parameter to **`seed`** in both functions. **Leave the bodies and the custom-property
  names untouched** — `projectChip.ts:19–21` forbids duplicating the hex, and `main.css` stays the
  authority on what the three colours are.
- Feed **`p.color_seed`** at every call site: `ProjectRail.vue:173` and `ProjectSettingsView.vue:58`.
- **Delete the `projectIndex` computed entirely** (`ProjectSettingsView.vue:46`). Leaving it as a
  dead fallback leaves a second answer to "what colour is this project" alive in the file whose
  docstring exists because the two surfaces once disagreed.

### Status vocabulary and the resurrection problem

`getOrCreateProject` (`storage.ts:612–644`) is keyed on **`UNIQUE root_path`**, so re-adding an
archived project's folder returns the archived row. **Picking the folder is an unambiguous statement
of intent, so it reactivates — loudly.** Return `{ project, reactivatedFrom: ProjectStatus | null }`
and let `project:add` carry `reactivated_from` so the renderer can say *"Unarchived Chorus — it was
in your archive."* **Reactivating relaunches nothing.**

**⚠ THE BOOT SEED MUST NOT USE THAT PATH.** `src/main/index.ts:432` calls `getOrCreateProject(DEV_WORKING_DIR)`
on every boot where no active project resolves. Add **`getProjectByRootPath`** and read first — or
archiving your dev project and restarting silently un-archives it, which is the feature failing at
the one moment nobody is watching.

### IPC shape

`projectSchema` gains **`status`** and **`color_seed`**, both **required and non-nullable**. This
deviates from the required-nullable house rule **deliberately**: after v15 every row has both, and
nullable would encode a state that cannot be reached.

**`sort_order` does not cross the wire.** Main returns the list already ordered; the renderer sends
the order it wants. Shipping the number would create a second authority on position.

### Storage and the ordered purge

`deleteProject(id, successorActiveId)` — **one transaction**, the `deleteProviderConfig` shape
(`storage.ts:1010–1021`) scaled up. **Order is load-bearing at two points**, and the rest is
soft-pointer cleanup SQLite will not do:

1. `council_messages` (via a `council_runs` subquery on `project_id`)
2. `council_runs`
3. `attention_spans`
4. `dispatches`
5. **`worktrees` — MUST precede sessions** (`worktrees.session_id` REFERENCES `sessions.id`)
6. `sessions`
7. `pane_layouts`
8. the two settings keys `view_state:<id>` and `last_launch_profile:<id>`
9. `active_project_id` (only if it names this project)
10. `projects`

**Steps 1–4 and 8 are soft pointers with no cascade.** **Step 8 is the first `tx.delete(settings)` in
the codebase** — there are zero today — and **nothing enumerates settings keys**, so a missed key is
unreachable forever by any surface the app has. **Steps 3 and 4 are the first deletes those two
tables have ever had.**

**Return the accumulated `changes`** — what was actually deleted, not a re-read prediction.

**Guards authored in main, before any transaction** — the count-and-refuse posture the repo already
takes (`countCredentialProfilesForProvider`, `countLaunchProfilesForProvider`), never
reverse-engineering a constraint throw:

- **Refuse if any session of the project is live.** The FK would **not** catch this: the row deletes
  cleanly and the PTY is orphaned.
- **Exact-equality name check** for D123.
- **Permutation check** for `reorder`, against `listProjects()`'s actual ids (see correction 4).
- A new **`requireLaunchableProject`** applied to `session:launch` (`src/main/ipc.ts:869`),
  `session:launch-context` (`:1196`) **and `council:start` (`:2407`, which has no project guard at
  all today)**.

### Archive semantics

- **Kill the live PTYs, then heal every `'running'` row of that project to `'exited'`.** Not
  redundant: `kill()` is asynchronous and the exit event may never land, leaving a row that
  relaunches on unarchive.
- **Clear `restorePending` for the project** — a new one-line `SessionManager.clearRestorePending`.
  The map is private (`sessionManager.ts:154`) with no public clear, and a mid-restore archive
  otherwise strands a spinner that never concludes (`TerminalPane.vue:309` reads the flag).
- **Reassign `active_project_id`** via a pure `computeSuccessorActiveId`, and retitle the window —
  `project:select` (`src/main/ipc.ts:3004`) and `project:update` (`:3036`) are the only two places that set
  the title today, and a third path that forgets leaves the titlebar naming a project you archived.
- **Boot resolution skips archived projects** (`src/main/index.ts:429–434`); **`project:select` throws on
  one**; **the palette filters archived out but KEEPS hidden** (`src/renderer/src/palette/commands.ts:62–71`) — the
  fast way back to a project you tucked away.

### Renderer

New pure module **`src/renderer/src/projectRail.ts`** — `partitionRail`, `tuckedLabel`, `moveItem`,
`visibleIndexToFullIndex`. **`.ts` so Vitest reaches it**: the `projectChip.ts` precedent, and the
environment is `node` with **no `.vue` tests in the repo at all**.

**Partition rule: visible when `status === 'active' || p.id === activeId`.** The second clause is
load-bearing — a hidden project may be the active one, and without it you would be staring at a
workspace whose project is not in the rail.

**Lifecycle actions live in `ProjectSettingsView.vue`, not the rail.** The gear is already an
absolutely-positioned **sibling** because button-in-button is invalid HTML
(`ProjectRail.vue:182–187`); a second and third sibling at 208px (`:331`) is unworkable; and there
is no popover primitive to reuse. **The tucked rows carry only `Unhide` / `Unarchive`. Delete is
never offered from the rail** — one destructive door, behind the typed name.

**Drag-to-reorder is built from scratch with no dependency.** Pointer Events, not HTML5 DnD (which
drags a ghost label and needs `preventDefault` in three handlers). A **14px grab handle** — a
sibling, not a child — because the row itself is the click target for `select`, and a drag threshold
on the row makes every project switch a potential accidental reorder. One `getBoundingClientRect`
snapshot at `pointerdown`; **4px threshold**; **transforms only, no DOM reordering during the drag**;
auto-scroll within **24px** of either edge; **Escape and `pointercancel` abort with no write**;
`prefers-reduced-motion` honoured on the displaced rows only. Disabled when the rail is collapsed
(`ProjectRail.vue:110–124`) and inside the disclosure. **Alt+↑/↓ keyboard fallback ships in the same
task**, not later.

### The shared, testable sentence

New **`src/shared/projectLifecycle.ts`** — `describeProjectDeletion`, `describeArchive`,
`describeHide`. The `councilDocket.ts` precedent, and its reason restated verbatim from
`councilDocket.ts:9–12`: interpolating the one sentence that has to be right into a `.vue` template
makes it *"the one sentence nothing checks."*

Contract: **name the project**; **state every non-zero count with correct plurals**; **omit zero
clauses rather than printing "0 sessions"** (D76); **state what survives in its own sentence** — the
folder on disk (D121) and the worktree folders Chorus stops tracking (D124); **state
irreversibility**.

---

## Tasks — strictly ordered

**⚠ THE ORDER IS NOT A PREFERENCE.** Task 2 cannot partition the list before Task 1 decouples the
colour, or hiding one project repaints every legacy project below it.

| # | Task | Independently verifiable by |
|---|---|---|
| **1** | **Schema v15, status vocabulary, colour decoupling.** Migration + Drizzle mirror, `status`/`color_seed` on `projectSchema`, both `projectChip.ts` functions re-parameterised, `projectIndex` deleted, `getProjectByRootPath` + the boot-seed fix. | App boots on the existing DB; rail order and **every chip colour pixel-identical** to a pre-migration screenshot; **`IpcChannel` still 64** |
| **2** | **Lifecycle end to end** — four channels, `deleteProject`'s ordered purge, archive semantics, the guards, the rail disclosure, the settings section, the typed-name delete. | Hide / archive / unhide / unarchive / delete all work; an archived project **cannot be selected, launched into or councilled**; **`IpcChannel` 68**, handlers **62 / 0**; the counts in the confirm read from a real database |
| **3** | **Drag + Alt+Arrow reorder.** `projectRail.ts`'s pure helpers, the pointer-event drag, the keyboard fallback, the `project:reorder` caller. | Order survives restart; **chip colours do not move**; Escape cancels with **no write**; still **68** channels |

**`project:reorder`'s channel, schema and handler land in Task 2 with no renderer caller** — the
`deleteCouncilRun` pattern this repo already praises (`storage.ts:1955–1956`: *"Nothing calls this
yet. It exists so 3b-3 inherits the transaction rather than inventing a second, half-atomic one"*).
That keeps the whole D125 declaration and **both** `ipc.test.ts` tripwire edits in one place.

### ⚠ Declared deviation from `/phase-kickoff`'s document set

That skill pairs every task with a `Task-N-#.md` **and** an `ImplementationSpec-N-#.md`. **Matthew
asked for one prompt covering everything**, and the ExecutionPrompt template is self-contained by
construction, so **`Phase-3h-ExecutionPrompt.md` carries the per-task specification inline** and no
`Task-3h-*.md` / `ImplementationSpec-3h-*.md` files exist. **Stated here so a later reader does not
read the missing files as an omission.**

---

## The purity contract for this phase

- **Exactly ONE migration**, in Task 1 only. `MIGRATIONS.length` **14 → 15** and stops there.
  `sqliteTable(` stays **16** — **no new table**.
- **Exactly FOUR channels**, all declared in Task 2 (D125). `IpcChannel` **64 → 68**,
  `ipcMain.handle(` **58 → 62 / 0**. Task 1 holds at **64 / 58**; Task 3 holds at **68 / 62**.
- **One payload reshape, bounded:** `projectSchema` gains `status` and `color_seed`. **Nothing else
  on the wire changes shape.**
- **No dependency is added.** The drag is written by hand; that is a decision, not an oversight.
- **Nothing is written outside the database** (D121). No `fs` write, no git command, in any task.
- **No test may be edited to accommodate a change.** Baseline **1219 across 34 files**, and the rule
  is **"never fewer"**. The two `toHaveLength` tripwires are *updated together, deliberately, in one
  commit* — that is not the same thing as loosening a test.
- **The deliberation protocol, the vault, the adapters and the council are untouched.** A diff that
  reaches `councilCore.ts`, `vault*`, `adapters/` or `apiSession.ts` has left this phase.

## Hazards — all four verified at `78ef546`

- **Two `toHaveLength(64)` assertions**, `src/shared/ipc.test.ts:2858` **and** `:3175`. Editing one
  ships a green suite with a dead tripwire — which that file's own comment
  (`src/shared/ipc.ts:225–230`) calls *"worse than no tally."*
- **`ProjectsList` fixture churn.** `commands.test.ts:32–66` already documents having been broken
  this way **twice** — by `sessionCount` (D80), then by `color`/`description` (v13). `status` and
  `color_seed` make it three.
- **D14 structured clone.** `ordered_ids` built from a Pinia array is a **Vue Proxy**, and `invoke`
  throws *"An object could not be cloned"* with **no compile-time signal**. Build a fresh `string[]`.
- **The attention reporter keeps naming a deleted project.** `attention_spans.project_id` is a soft
  pointer and the handler (`src/main/ipc.ts:2920`) is deliberately unguarded and fire-and-forget, so main will
  happily write spans for a project that is gone. Not a bug to fix in this phase — a fact the delete
  path must not assume away.
- **Drizzle and the hand-rolled DDL are synchronised by hand only** (D7): a column in one and not the
  other typechecks clean and fails on the first query.
- **The permutation check compares against real ids**, not a uuid predicate — see correction 4.
- **Deleting the active project while its panes are mounted:** the renderer must set
  `activeView = 'workspace'` **before** reloading, or it lands on `ProjectSettingsView.vue:243`'s
  permanent `Loading project…` branch.

## Gates

- **G1** `npm run typecheck` exits 0.
- **G2** **Run it, don't just compile it.** Every task has runtime obligations no test can reach —
  see the ExecutionPrompt's runtime section. Vitest is `environment: 'node'`, **cannot import
  `storage.ts`** (better-sqlite3 is built for the Electron ABI — re-confirmed at `78ef546`: a plain
  `node` `new Database(':memory:')` still fails to load the binding), and there are **no `.vue`
  tests**.
- **G3** One narrated commit per task, staged **by path**.
- **G4** `npm run grep:secrets` clean across 6 patterns, **plus** the channel/handler/migration
  tallies with their expected numbers stated inline.
- **G5** Council review checkpoint — **not triggered.** This phase makes no security decision and no
  protocol decision. The schema change is three columns on an existing table under a settled
  nullable ruling; the destructive path is bounded by D121/D124 to rows Chorus itself wrote.
  **Recorded so the absence is deliberate.**

## Cost envelope

**`$0.00`.** Nothing in this phase calls a provider. **A council run would breach the envelope**, and
the D125 exception does not license one.

## Milestone

A project can be **hidden, archived, unhidden, unarchived, deleted and reordered**; an archived
project **cannot be selected, launched into, or made the subject of a council**; the order survives a
restart; **a delete states its counts before it happens and names what survives**; and **not one chip
changes colour** on the existing database except where the same-millisecond tie-break in v15's
back-fill honestly forces it — stated in the migration comment rather than discovered by the user.

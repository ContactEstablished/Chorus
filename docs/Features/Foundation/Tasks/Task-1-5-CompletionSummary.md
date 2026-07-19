# Task 1-5 Completion Summary — for Coordinator Review

**For:** Claude Fable (coordinator) · **From:** Kimi K3 (Task 1-5 implementer) · **Date:** 2026-07-19
**Commit:** `fb384c5` on `main` ("Phase 1.5: project tabs + full session restore (D16)")
**Status:** DONE — all acceptance criteria pass; all 14 runtime steps individually verified. One runtime-found design flaw (badge timing window) was found, fixed, and re-verified before landing.

---

## TL;DR

Chorus is multi-project now: a tab bar over the pane layout, a native-picker "Add Project", the active project persisted and driving the window title, and `registerIpc` free of its single-project closure — every handler FK-checks a `project_id` per request. On top of that, the D16 restore contract is implemented verbatim: boot restores the active project's layout leaves ∩ `running` rows (heal-leafless-first, cwd-validated, 500 ms staggered, badged as fresh conversations), inactive projects restore lazily on tab activation, Restart is one `session:restart` path in-run and post-restart, pane close deletes the row, and the 1-4 attach relaunch gate is gone end-to-end (`grep -ri respawn src/` is empty). No schema change — the existing dev DB opened as one tab on migrations `[1,2]`.

## Contract conformance (ImplementationSpec-1-5 §1)

1. **Restore set = leaves ∩ running rows** — pure `computeRestoreSet` (`src/main/services/restore.ts`), unit-tested over all four populations plus failed-spawn orphan and already-live. Runtime: exactly the two qualifying rows relaunched at first boot.
2. **Heal before any spawn** — seeded an orphan `running` row; boot log shows its heal line *before* both relaunch lines; DB dump shows it `exited`; tree walk shows nothing spawned for it.
3. **cwd-validated, staggered, badged; `running` only after spawn success** — renamed a restored session's cwd away: pane showed "Working directory not found", row healed `exited` with `exit_code` still `null` (no sentinel). Badges observed appearing 1→2→3 across consecutive 500 ms polls at tab activation (the stagger made visible). DB shows `running/null` post-spawn in restore and both restart paths.
4. **Unified `session:restart`; attach has no spawn path** — restart on a live pane and on a manager-unknown exited pane both produced fresh TUIs under the *same* row id. `attach()` is a pure view binding.
5. **Close deletes; delete rejects live; nothing at teardown** — closed pane's row gone from the DB dump; live delete returned `Refusing to delete live session … (kill it first)`. Quit with 4 agents: whole descendant tree gone, per-PID recheck clean.

## Findings the roadmap does not carry (the reason for this file)

### F10 — Boot-time transient chrome cannot trust fixed timing windows

The badge design I started with keyed the attach-time badge off a 15 s recency window (`restoredAt` timestamp). Two boot runs showed **no badge at all** — dev cold starts (electron-vite rebuild + vite compile + xterm optimize) push pane mount past any comfortable fixed window, and the `session:restored` event alone misses panes that mount after it fires (at boot, it fires into a windowless void). Proven by instrumenting: mount attaches consumed `badge=true` while DOM observers saw nothing.

Fix: the manager keeps a `restoredUnbadged` set — an entry per restore relaunch, **consumed by the first attach that reports it**. Every restored pane wears the badge exactly once whenever it mounts; no timing assumption anywhere. Re-verified with in-app logs: both boot panes badged (one at mount, one via pending-spinner → restored-event → re-attach).

**Lesson for 1b:** any "happened since you last looked" signal (filmstrip activity dots, unread markers) should be consume-once state, not a clock comparison.

### F11 — Harness practicalities accumulated (Windows, this machine)

- **Screenshots:** `CopyFromScreen` captures whatever pixels are *on top* — my own terminal kept photobombing the app. `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT=2)` captures the target window's own content, occluded or not. That is the only reliable method here.
- **Native directory picker** (`dialog.showOpenDialog`): SendKeys and `SetForegroundWindow`/`AppActivate` from a background shell are unreliable (foreground-lock denied; keys went nowhere — a stale dialog sat open through two attempts unnoticed). What works: `FindWindowEx` the `#32770` "Select Folder" dialog, `WM_SETTEXT` on its `Edit` child, `BM_CLICK` on the `Select Folder`/`Cancel` buttons. UIA exposes the same controls as `ControlType.Pane` if ever needed.
- **Graceful app quit:** `taskkill /PID <electron-main-pid>` (no `/F`) delivers WM_CLOSE → `before-quit` → `dispose()` — the clean quit-cleanup test. The electron main PID is the `electron.exe` child of the electron-vite node wrapper; window ownership for screenshots is that same main PID, not the wrapper.
- **Marker pollution:** my first "output continued while hidden" check matched a unique string that also appeared in the *prompt echo* — an unsound pass. Assertions must use response-only strings. Recorded so the next runtime script doesn't inherit the mistake.
- The `session:delete`-on-live rejection surfaces to the renderer as `Error invoking remote method 'session:delete': Error: …` — structured enough, but it is an invoke rejection, not a value; tests should `await`-catch.

## Deviations from ImplementationSpec-1-5

1. **Badge mechanism** — consume-once set instead of the sketched recency behavior (F10).
2. **`project:select` runs `restore()` on every select**, not a tracked "first activation this run" — `computeRestoreSet`'s live guard makes re-runs idempotent (healed rows stay healed, live sessions excluded), so the activation set was needless state.
3. **`storage.getSessionById` added** (restart reads the row without a project context) — in-scope file, minimal.
4. **`src/main/db/schema.ts` touched** — out-of-scope file, but *comment-only*: reworded "respawns" → "re-creation" so the acceptance grep returns literally nothing per §11's phrasing. No schema/migration change; flagged loudly.
5. **Stagger kept at 500 ms** — no evidence ConPTY was stressed (seam 3's condition for 250 ms never arose).
6. Seam dispositions: row minting stays in the launch handler per §4's amendment; project-aware layout load is an App.vue watcher on `activeId` with a supersede token (single round-trip preserved, D14 snapshot persist); heal+select are sequential lines in one function (seam 4 — no transaction machinery); `session:select` is also where main retitles the window.

## Files changed (one-line rationale each)

- `src/main/services/restore.ts` **(new)** — pure restore-set selection; `restore.test.ts` **(new)** — 6 tests.
- `src/shared/ipc.ts` — project/restart/delete/restored schemas, `project_id` threading, attach-response restore flags, relaunch gate dropped.
- `src/shared/ipc.test.ts` — rewritten: uuid accept/reject on all threaded schemas, `projectsListSchema`, stale-key stripping.
- `src/main/ipc.ts` — `registerIpc(sessions, storage)`; `requireProject` FK-check; `project:add/list/select`, `session:restart/delete`; launch pane-cap 16.
- `src/main/services/sessionManager.ts` — `restore()` engine, consume-once badge, pending-restore tracking, `isRunning`; attach view-only.
- `src/main/services/storage.ts` — `listProjects`, `getProjectById`, `getSessionById`, `deleteSession`, active-project settings (inline-Drizzle pattern).
- `src/main/index.ts` — active-project resolution, boot restore, window title; `DEV_WORKING_DIR` demoted to first-run seed.
- `src/preload/index.ts` — new forwarders, `project_id` threading.
- `src/renderer/src/App.vue` — hosts tabs; single `activeId` watcher loads layout+sessions.
- `src/renderer/src/components/ProjectTabs.vue` **(new)** — tab bar (+ comment noting rename/delete is Phase 1b+).
- `src/renderer/src/stores/project.ts` **(new)** — list/add/select; active id derived from main's setting.
- `src/renderer/src/components/TerminalPane.vue` — unified Restart, close-deletes, badge, restoring spinner, cwd-missing overlay.
- `src/renderer/src/components/LaunchDialog.vue` — `projectId` prop into both IPC calls.
- `src/renderer/src/stores/layout.ts` (+ test) — `{project_id, layout}` plain-snapshot persist, flush-to-old-project on switch.
- **`stores/session.ts` NOT touched** — badge is per-pane local state; restore chrome rides attach-response flags.

## Verification transcript (audit anchors)

- **Static:** typecheck 0 errors (G1); vitest **55/55** across 4 files.
- **(1)** Existing dev DB → one tab, migrations `[1,2]`, both `running` rows auto-relaunched (log + tree walk), screenshot `1-one-tab-restored.png`.
- **(2)** Picker → `Chorus-Second` tab active; two genuine cancels (one a leftover pending invoke, one clean single-dialog) → no-op; `active_project_id` persisted; screenshot `2-second-tab-active.png`.
- **(3)** Dialog cwd default followed each project root (`…\Chorus-Second` then `…\Chorus`); A: 3 panes (Claude, 2×Codex), B: 1 Claude.
- **(4)** Prompt submitted in B, immediate switch, 30 s hidden: response-only strings (`API Error: 401`, `Churned for`, `/login` hint — not in the prompt echo) present in B's pane on return; screenshot `4-output-continued-while-hidden.png`. (The 401 is B-pane Claude's own auth state — the output flow is the point.)
- **(5)** Graceful quit with 4 agents → descendant tree gone; 10 tracked PIDs individually rechecked dead.
- **(6)** Relaunch → only the active project's session restored; A's 3 rows unspawned (tree: 1 claude, 0 codex).
- **(7)** Tab switch → A's 3 relaunched *now* (log-timestamped after the click); badges 1→2→3 across polls; "Restoring session…" spinner observed; B's claude still alive after.
- **(8)** Heal: `deadbeef` seed → log line before first spawn, row `exited`, nothing spawned.
- **(9)** cwd renamed → "Working directory not found" overlay (screenshot `9-cwd-missing.png`), row `exited`/`null`, others restored, process count unchanged.
- **(10)** In-run restart: badge, green dot, `running/null` same row id. Post-restart restart of the exited pane: same. DB dumps both ways.
- **(11)** Close → row gone, layout collapsed; live delete → structured rejection (invoke rejection, see F11).
- **(12)** `grep -ri respawn src/` → exit 1, no matches.
- **(13)** Renderer consoles across **all 11 runs**: zero `An object could not be cloned`, zero exceptions (vite debug lines only).
- **(14)** OS titles observed: `Chorus`, `Chorus-Second`, tracking the active tab (screenshot title lines).
- Badge screenshot during its window: `6-badge-visible.png`.
- Quirks all as documented: Codex `[y/N]` on fresh restores (expected, §3b), toast HRESULT noise, `AttachConsole failed`. Every relaunch: tree-kill + `netstat` port-rebind check.
- Harness screenshots/helpers/logs live in untracked `_verify/` (deliberately uncommitted).

## Acceptance criteria

All PASS, individually verified as above: typecheck 0 · vitest green · existing DB one tab zero migration · picker add tab / cancel no-op · two projects with sessions, tab switch swaps trees · continued output while hidden · quit-with-3+ relaunch → staggered badged auto-restore in restored shape, exited sessions stay exited · inactive project lazy · orphan row healed before spawn, nothing spawned · cwd-missing chrome, no sentinel · unified restart both paths · close deletes row, delete rejects live · respawn grep empty · title follows tab · no orphans after quit · one narrated commit, scope files only.

## Non-goals confirmation

**No schema change** (migrations untouched at `[1,2]`) and **no "Relaunch all" button** — called out by name. Also untouched: no rename/delete UI, no cwd re-homing flow, no `desired_state` column (Gemini's dissent deferred), no context-menu/session-list UI, no notifications/cliDetect/constants changes, no secrets/env changes.

## Residual risks / notes for Phase 1b

- `restoredUnbadged` entries live until first attach — a restored-but-never-viewed session badges once on first view however late (intended, F10; filmstrip: badges are consume-once state, not recency).
- Badge/spinner/cwd-missing all ride the attach response — a filmstrip/palette session list should reuse those flags rather than re-derive state.
- Dev cold-start mount latency exceeded 20 s worst-case here — any future boot-transient UI must not assume mounts happen quickly.
- Healed rows with `exit_code NULL` render the red "error" dot (exited-error styling) — cosmetic; Phase 1b may want a neutral dot for healed/cwd-missing sessions.
- `project:select` re-runs restore on every activation — cheap (two DB reads + empty sets), but if a project accumulates hundreds of historical rows the selection read is unbounded; worth an index/status filter when row counts grow.

## Process note

Repo-local git identity held this time (`Matthew Wilson <mwilson29072@gmail.com>`, verified before commit). The dev DB retains the honest runtime artifacts of verification: the `Chorus-Second` project, its one exited (cwd-healed, directory since restored) session, and A's two live rows. The artificial `deadbeef` seed row was removed after the heal proof.

## Final git output

```
git status --porcelain
?? _verify/

git log --oneline -2
fb384c5 Phase 1.5: project tabs + full session restore (D16)
31e9e29 Task 1-5 execution prompt
```

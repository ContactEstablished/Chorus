# Task 1-4 — Launch Dialog + True Multi-Session

_Sub-phase 1.3 of Phase 1 (Foundation). Windows-only. Serial after Task 1-3._

## Source Of Truth
- `CLAUDE.md` (locked architecture rules).
- `docs/PLAN.md` — architecture and roadmap; specifically the "cwd validated" and "capability-driven UI" notes.
- Phase 1 decisions RESOLVED 2026-07-18: D1 (Zod in main only), D3 (sessions in main), D4 (verify CLI flags live), D8 (Tailwind), D9 (owned binary split-tree layout).
- This task file governs scope. `ImplementationSpec-1-4.md` governs exact contents.

## Initial Starting Point
State inherited from Task 1-3 (as enumerated in the Phase 1 shared context, 2026-07-18):

- **SessionManager** (`src/main/services/sessionManager.ts`) keys sessions by **stable DB session ids** (session row id = `PtySession.id`; the PTY instance is ephemeral). `attach({sessionId?, agent}, cwd)` currently spawns or reattaches; `kill(sessionId)` (from 1-1); `getAgent(sessionId)`; `dispose()`. One session row per pane, but **launch is still implicit** — the app auto-attaches the two seeded sessions on boot.
- **`sessions` table** (Drizzle schema `src/main/db/schema.ts`): `id` TEXT PK stable UUID, `project_id`, `agent` (`'claude'|'codex'`), `cwd`, `status` (`'running'|'exited'`), `exit_code`, `created_at`.
- **Layout**: `pane_layouts.layout_json` holds the versioned tree. `src/shared/layout.ts` is a pure module (`splitPane`, `removePane`, `setRatio`, `changeDirection`, `swapPanes`, `collectSessionIds`, `findLeaf`, `convertLegacyFlatLayout`). `layoutJsonSchema` lives in `src/shared/ipc.ts` and is parsed in main. `layout:get` returns `{layout, sessions:[{id,agent,status}]}`; `layout:set` persists ratio changes (clamped, re-validated in main). `LayoutRenderer.vue` renders the tree recursively; `TerminalPane` mounts per leaf by `sessionId`. **Split buttons are DISABLED** (deferred here to 1-4); close kills the session + collapses the leaf.
- **Pane chrome** (1-1): per-pane header with agent label, status dot (running / exited-ok / exited-error), Kill + Restart buttons; `session:kill` IPC.
- **storage** (`src/main/services/storage.ts`, Drizzle-ported in 1-2): `getOrCreateProject(rootPath)` seeds project + layout; `createSession`, `getSessionsForProject`, `updateSessionStatus`; `getPaneLayout` with legacy lazy-conversion; window-bounds in settings. DB at `userData/chorus.db` (WAL).
- **IPC** (`src/main/ipc.ts` `registerIpc(sessions, storage, project)`): `session:attach/write/resize/kill`, `session:data/exit` events, `cli:detect`, `layout:get/set`. All Zod in main. Preload `src/preload/index.ts` exposes Zod-free typed forwarders; renderer `window.chorus` typed via `ChorusApi`.
- **main** `src/main/index.ts`: on `whenReady` → storage init, `getOrCreateProject(DEV_WORKING_DIR)` (`src/main/constants.ts` line 8, _current_), `registerIpc`, `watchSessionExits`, `createWindow`.
- **cliDetect** (`src/main/services/cliDetect.ts`): `resolveCli(name)`, `detectClis()` memoized (claude/codex/git/docker/node found/path/version).
- **Renderer**: `App.vue` renders `LayoutRenderer` for the current project; Pinia session store keyed by `sessionId` `{agent, status, exitCode}`; layout store `{tree, dirty}`.

## Goal
Replace the implicit auto-attach of two seeded sessions with an **explicit launch flow** and lift the one-session-per-agent-kind limitation so the app can run N concurrent sessions of the same agent (e.g. two Codex TUIs at once). A user launches an agent through a `LaunchDialog` — either from an empty-state screen when no panes exist, or by pressing a now-enabled split button on an existing pane, which opens the dialog and drops the new session's leaf into the split tree. A new `session:launch` IPC creates a stable session row, spawns its PTY, and returns an attach-style snapshot, with the target `cwd` validated in main as a security boundary. Fresh databases seed an empty layout; existing databases still upgrade through the legacy conversion path.

## Exact Scope
Touch **only** these files:

| File | Change |
|---|---|
| `src/main/services/sessionManager.ts` | Add `launch(agent, cwd)`; remove any residual one-per-kind / `findByAgent` logic; tighten `attach` to reattach-existing-only (no respawn of dead sessions). |
| `src/shared/ipc.ts` | Add `launchRequestSchema` / `launchResponseSchema`; export request/response types. |
| `src/main/ipc.ts` | Register `session:launch` handler (Zod-validate, main-side cwd `fs.existsSync` + `path.isAbsolute` check); wire `recent_cwds` read/write via storage. |
| `src/preload/index.ts` | Add Zod-free `launch(req)` forwarder to `ChorusApi`. |
| `src/main/services/storage.ts` | Stop seeding `DEFAULT_LAYOUT` on first run (seed empty layout / no `pane_layouts` row); keep legacy conversion intact; add `getRecentCwds()` / `pushRecentCwd(path)` (settings key `recent_cwds`, max 10). |
| `src/renderer/src/components/LaunchDialog.vue` | New component (Tailwind): agent picker driven by `cli:detect`, cwd input + "use project root" default + recent-cwds list, launch button, Esc-cancel, basic focus trap. |
| `src/renderer/src/components/EmptyState.vue` | New component: shown when the layout tree is null; single Launch button opening `LaunchDialog`. |
| `src/renderer/src/components/LayoutRenderer.vue` | Enable split buttons; render `EmptyState` when tree is null. |
| `src/renderer/src/components/TerminalPane.vue` (pane header) | Split (H/V) buttons emit an event carrying `{targetSessionId, direction}` to open the dialog. |
| `src/renderer/src/stores/layout.ts` | Apply `splitPane` on launch success; set tree to `null` when the last pane closes; persist via `layout:set`. |
| `src/renderer/src/stores/session.ts` | Insert the new session snapshot on launch. |
| `src/shared/layout.ts` | Only if a helper for "tree is empty/null" is genuinely absent — otherwise leave untouched. |

If a change appears to need a file not in this table, stop and raise it rather than expanding scope.

## Non-Goals
- **No project switching / tabs** — that is Task 1-5.
- **No launch profiles, model, or effort options** — Phase 3. The dialog exposes agent + cwd only.
- **No worktree modes** — Phase 2.
- **No keyboard palette / command palette** — Phase 1b.
- **No per-agent extra CLI args** — bare launch stays bare (D4 note).
- **No auto-relaunch on restart** — after an app restart in this task, panes show **exited/dead** chrome with the layout shape intact. Automatic relaunch of previously-running sessions is Task 1-5's restore contract.
- **No changes to secrets/env handling** (D5 — env untouched, no credentials).
- **Do not revert, stage, or commit unrelated or untracked files, including anything under `docs/`.** Commit only the files you changed for this task.

## Dependencies
- Tasks 1-1, 1-2, 1-3 landed (Tailwind active, Drizzle data layer, layout view with the split-tree and disabled split buttons).
- `detectClis()` available and returning per-agent found/path/version.
- No new npm dependencies. (`fs`/`path` are Node built-ins available in main.)

## Step-by-step Work
1. **SessionManager multi-session + state machine.** Remove any residual one-per-kind lookup (`findByAgent` or equivalent). Add `launch(agent, cwd)`: call `storage.createSession(...)` to mint a stable row id, spawn the PTY, return an attach-style snapshot. Tighten `attach({sessionId, agent}, cwd)` to **reattach-existing-only**: an unknown or exited-dead session id returns a snapshot with `status: 'exited'` rather than respawning. Respawn semantics belong to the existing **Restart** button (same row id). See ImplementationSpec-1-4 for the exact four-state machine (launch / attach / restart / kill).
2. **IPC schemas.** In `src/shared/ipc.ts` add `launchRequestSchema` (`{agent: agentKindSchema, cwd: z.string().min(1)}`) and `launchResponseSchema` (attach-style snapshot, or a structured `{ok:false, reason}` error). Export the inferred types.
3. **session:launch handler.** In `src/main/ipc.ts`, register `session:launch`: Zod-parse the request in main, then validate `cwd` — `path.isAbsolute(cwd)` and `fs.existsSync(cwd)` — treating failure as a validation error surfaced back to the dialog. On success call `sessions.launch`, then `storage.pushRecentCwd(cwd)`, and return the snapshot.
4. **Preload forwarder.** Add a Zod-free `launch(req)` method to the `ChorusApi` surface in `src/preload/index.ts`.
5. **storage first-run + recent-cwds.** Change `getOrCreateProject` to seed an **empty** layout (no `pane_layouts` row) for fresh DBs; leave the legacy conversion path for existing DBs untouched. Add `getRecentCwds()` and `pushRecentCwd(path)` backed by settings key `recent_cwds` (unshift, dedupe, cap 10); main validates each entry is a string before returning.
6. **LaunchDialog.vue.** Build the Tailwind dialog: agent cards from `cli:detect` (undetected agents disabled with a "not found" note — capability-driven UI); cwd text input defaulting to project root with a recent-cwds picklist; Launch button; Esc cancels; a basic focus trap. On submit, call `window.chorus.launch({agent, cwd})`; on `{ok:false}` show the reason inline without closing.
7. **EmptyState.vue.** When the layout tree is null, render a centered Launch button that opens `LaunchDialog` with no split target (result becomes the single root leaf).
8. **Enable split + wire tree insertion.** In the pane header, enable the H/V split buttons to emit `{targetSessionId, direction}`; `LayoutRenderer`/`App` opens `LaunchDialog` in "split" mode. On launch success, the layout store applies `splitPane(tree, targetSessionId, direction, newLeaf)` and persists via `layout:set`.
9. **Empty-state on last close.** When closing the final pane, set the store tree to `null` and delete the `pane_layouts` row (persist as absent), so `getPaneLayout` returns null and the renderer shows `EmptyState`. Keep the schema strict.
10. **Session store.** Insert the returned snapshot keyed by `sessionId` on launch success.

## Test Expectations
- **Unit (Vitest):** extend the `src/shared/layout.ts` tests to cover `splitPane` inserting a new leaf at a target on both H and V, and `removePane` collapsing to `null` when the last leaf is removed. Pure-module logic only — no Electron.
- **Schema tests:** `launchRequestSchema` accepts a valid `{agent, cwd}` and rejects empty/missing fields.
- **Main-side cwd validation** (`fs.existsSync` / `path.isAbsolute`) is exercised at **runtime** (G2), not unit-tested, because it touches the real filesystem and PTY spawn — see Verification.

## Verification Commands
Run from repo root `C:\Projects\ContactEstablished\Chorus`:

```
npm run typecheck
npx vitest run
npm run dev
```

## Acceptance Criteria
- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green (G, incl. new layout/schema tests).
- [ ] Fresh DB (delete `userData/chorus.db*`) boots to the **empty state**, not two seeded sessions.
- [ ] Launching Claude from empty state produces a full-window single leaf with a live TUI.
- [ ] Split V then launch Codex yields a 50/50 two-pane layout, both TUIs live.
- [ ] Split the Codex pane H and launch Codex again → **three panes, two independent Codex TUIs**, each interactive (the multi-session-per-kind proof — screenshot per G2).
- [ ] `cwd` that does not exist or is not absolute is rejected with an inline dialog error; no session row is created.
- [ ] Undetected agents appear disabled with a "not found" note.
- [ ] `recent_cwds` persists across launches, deduped, capped at 10.
- [ ] Closing the last pane returns to the empty state; the `pane_layouts` row is gone.
- [ ] An existing dev DB still opens (legacy conversion path unbroken).
- [ ] One narrated commit for this execution session (G3), touching only the files in Exact Scope.

## Review Checklist
- [ ] All Zod validation is in **main**; preload and renderer stay Zod-free (D1, CSP).
- [ ] `cwd` validated in main via `path.isAbsolute` + `fs.existsSync` before any spawn (security boundary).
- [ ] No CLI flags added; bare launch stays bare; flags (if any touched) verified against `--help`, not memory (D4).
- [ ] No secrets/keys in args, logs, or transcripts (unchanged; confirm nothing new logs `cwd`-adjacent env).
- [ ] SessionManager still owns spawning; renderer never spawns a process (D3).
- [ ] `attach` no longer respawns dead sessions; Restart owns respawn.
- [ ] Legacy DB conversion path untouched.
- [ ] No untracked/`docs/` files staged or reverted.

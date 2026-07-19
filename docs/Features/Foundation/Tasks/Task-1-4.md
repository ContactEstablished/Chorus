# Task 1-4 — Launch Dialog + True Multi-Session

_Sub-phase 1.3 of Phase 1 (Foundation). Windows-only. Serial after Task 1-3._

## Source Of Truth
- `CLAUDE.md` (locked architecture rules).
- `docs/PLAN.md` — architecture and roadmap; specifically the "cwd validated" and "capability-driven UI" notes.
- Phase 1 decisions RESOLVED 2026-07-18: D1 (Zod in main only), D3 (sessions in main), D4 (verify CLI flags live), D8 (Tailwind), D9 (owned binary split-tree layout).
- This task file governs scope. `ImplementationSpec-1-4.md` governs exact contents.

## Inherited decision — session store rekey (from Task 1-2 review, ratified 2026-07-19)

The Task 1-2 completion review (`Tasks/Task-1-2-CompletionSummary.md`, item D3) asked who rekeys the renderer session store. **Ratified: Task 1-4 owns it.** Recorded as roadmap **D10**.

Today (verified 2026-07-19 at commit `81e8a0b`) the Pinia store is `Record<AgentKind, PaneSessionState>` — literally two fixed slots, `claude` and `codex` (`src/renderer/src/stores/session.ts`). `TerminalPane.vue` reads through that key everywhere: `store.sessions[props.agent]`, `store.dotStatus(props.agent)`, `store.setBusy(props.agent, …)`, `store.attached(props.agent, …)`, `store.exited(props.agent, …)`.

- **Task 1-3 must NOT touch this.** With one live session per kind, agent-keying is still correct; `LayoutRenderer` keys *pane components* by `sessionId` while the store stays per-kind. Rekeying there would be a large refactor riding along in a layout task, unverifiable until multi-session exists.
- **Task 1-4 must do it, and must do it FIRST.** The moment this task lands two concurrent Codex sessions, `store.sessions['codex']` becomes a single shared slot behind two panes: the second launch overwrites the first's `sessionId`, both status dots move together, killing one marks both busy, and one pane's exit event clears the other's state. This is not a cosmetic issue — it is the failure mode the task's own headline acceptance criterion (three panes, two independent Codex TUIs) is designed to expose.

The rekey is therefore **step 0 below**, landing and being verified before any launch-flow work.

## Inherited finding — IPC payloads must be plain objects (from Task 1-3, roadmap D14)

Task 1-3 hit this at runtime: `window.chorus.setLayout(this.tree)` threw **`Error: An object could not be cloned`**. Pinia state is a Vue reactive **Proxy**, and Electron's structured-clone algorithm refuses proxies. There is **no compile-time signal** — types are satisfied, the call site looks correct, and the failure only appears when the code actually runs. The 1-3 fix was to send `JSON.parse(JSON.stringify(this.tree))` from the store's persist path.

**This task creates several new renderer→main payloads** (`session:launch`, plus `layout:set` calls after `splitPane`). Any payload sourced from a Pinia store — or from a `reactive()`/`ref()` object anywhere — must be snapshotted to a plain object before crossing the boundary. Use `JSON.parse(JSON.stringify(x))` to match the 1-3 precedent, or Vue's `toRaw`/`structuredClone` if the shape makes that cleaner; the rule is *what crosses the bridge is inert data*, not the mechanism.

Because this fails only at runtime, the launch flow **must be exercised in the real app** (G2) — a green typecheck proves nothing here.

## Initial Starting Point

**Re-verified 2026-07-19 against HEAD `e7d6e60`** (Task 1-3 landed). `npm run typecheck` exits 0; `npx vitest run` = **27/27** across two files (`src/shared/layout.test.ts`, `src/renderer/src/stores/layout.test.ts`). Trust this section over any older doc line.

- **SessionManager** (`src/main/services/sessionManager.ts`) keys sessions by **stable DB session ids** (row id = `PtySession.id`; the PTY is ephemeral). `attach({sessionId?, agent}, cwd)` spawns or reattaches; `kill`, `write`, `resize`, `getAgent`, `onData`, `onExit`, `dispose`. **`findByAgent()` still exists** — the one-live-session-per-kind fallback when `attach` is called without a `sessionId`. Launch is still implicit: the app auto-attaches the two seeded sessions on boot.
- **`sessions` table** (Drizzle schema `src/main/db/schema.ts`): `id` TEXT PK stable UUID, `project_id`, `agent` (`'claude'|'codex'`), `cwd`, `status` (`'running'|'exited'`), `exit_code`, `created_at`.
- **Layout model**: `src/shared/layout.ts` — pure, immutable, no-op-on-invalid: `clampRatio`, `createLeaf`, `splitPane`, `removePane`, `setRatio`, `changeDirection`, `swapPanes`, `collectSessionIds`, `findLeaf`, `normalizeTree`, `convertLegacyFlatLayout`. Invariants everywhere: exactly 2 children per internal node, ratios ∈ [0.05, 0.95], no duplicate `sessionId`s, ≥1 leaf, `version: 1`.
- **IPC** (`src/main/ipc.ts` `registerIpc(sessions, storage, project)`): **9 channels** — `session:attach`/`write`/`resize`/`kill`, `session:data`/`exit` events, `cli:detect`, `layout:get`, **`layout:set`** (added in 1-3; re-clamps + re-validates in main, persists via `savePaneLayout`). All Zod in main. Preload exposes Zod-free forwarders incl. `setLayout`; `ChorusApi` is inferred from the object.
- **`LayoutRenderer.vue`** (1-3) — recursive; props `{node, path: (0|1)[], agentFor: (id) => AgentKind | undefined}`. Internal nodes render **splitpanes `~4.1.2`** (installed; spike GO); leaves mount `TerminalPane` by `sessionId`. A leaf whose session row is missing renders a "Session no longer exists" placeholder that **holds the split geometry**. `@resize` reads `payload.panes[0].size / 100` (real v4 API — not the old spec sketch) and rAF-batches into `applyRatio`.
- **`stores/layout.ts`** (1-3) — `{tree: LayoutJson | null, dirty}`; `loadLayout(layout)` **takes the tree as a parameter** (App.vue makes a single `layout:get` round-trip); `applyRatio(path, ratio)`; `removeLeaf(sessionId)`; `schedulePersist()` debounces 500 ms and sends a **plain JSON snapshot** (see D14).
- **`App.vue`** — one `layout:get` on mount → `layout.loadLayout(tree)` + `sessions.value = rows`; `agentFor(id): AgentKind | undefined`; renders `<LayoutRenderer v-if="layout.tree">`. There is **no `v-else`** — a null tree currently renders nothing at all.
- **`TerminalPane.vue`** — props `{sessionId, agent}`; attaches by `sessionId`; scrollback 5 000; ResizeObserver → continuous `fit()` + 150 ms-debounced `resizeSession`. Header: agent label, status dot, **Split ⬌ / Split ⬍ both `:disabled="true"`**, Restart, Kill, and **✕ close** (`onClose`) guarded by `isLastLeaf`.
- **Pane chrome** (1-1): status dot (running / exited-ok / exited-error), Kill + Restart, `session:kill` IPC — coexists with ✕ close in the same header.
- **storage** (`src/main/services/storage.ts`, Drizzle-ported in 1-2): `getOrCreateProject(rootPath)` seeds project + a **two-leaf 50/50 layout**; `createSession`, `getSessionsForProject`, `updateSessionStatus` (**still unwired** — D11), `getPaneLayout` (lazy legacy conversion, normalizes in memory only), `savePaneLayout`, window-bounds. DB at `userData/chorus.db` (WAL), migrations 1 + 2.
- **main** `src/main/index.ts`: on `whenReady` → storage init, `getOrCreateProject(DEV_WORKING_DIR)` (`src/main/constants.ts`), `registerIpc`, `watchSessionExits`, `createWindow`.
- **cliDetect** (`src/main/services/cliDetect.ts`): `resolveCli(name)`, `detectClis()` memoized (claude/codex/git/docker/node → found/path/version).
- **Session store** — **still `Record<AgentKind, PaneSessionState>`** with two pre-seeded slots, and `TerminalPane` reads through `props.agent` at every call site (`store.sessions[props.agent]`, `dotStatus`, `setBusy`, `attached`, `exited`). Task 1-3 deliberately left this alone. Rekeying it is **step 0** of this task (D10).

### Two 1-3 leftovers this task must clear

Both are guards Task 1-3 installed *because* empty layouts were illegal in Phase 1 so far. This task legalizes them, so both must come down or the new flows are unreachable:

1. **`TerminalPane.onClose` / the ✕ button are hard-guarded by `isLastLeaf`** (`collectSessionIds(root).length <= 1`), with the tooltip "Cannot close the last pane". Closing the final pane is currently **impossible** — the empty-state acceptance criterion cannot pass until this guard is removed.
2. **`stores/layout.ts` `removeLeaf` early-returns when `removePane` yields `null`** ("never blank the app by dropping the last leaf"). It must instead set `tree = null` and persist the layout's absence.

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
| `src/main/services/storage.ts` | Stop seeding the default layout on first run (no `pane_layouts` row, and no seeded session rows) — the seed lives in the private `buildDefaultLayout(projectId)` + `findOrCreateSession`, **not** in a `DEFAULT_LAYOUT` const; keep legacy conversion intact; add `getRecentCwds()` / `pushRecentCwd(path)` (settings key `recent_cwds`, max 10) and `clearPaneLayout(projectId)` (deletes the row — the empty signal is the row's **absence**). Note there are no generic `getSetting`/`setSetting` helpers today; follow the `getWindowBounds` / `saveWindowBounds` Drizzle pattern or add the pair. |
| `src/renderer/src/components/LaunchDialog.vue` | New component (Tailwind): agent picker driven by `cli:detect`, cwd input + "use project root" default + recent-cwds list, launch button, Esc-cancel, basic focus trap. |
| `src/renderer/src/components/EmptyState.vue` | New component: shown when the layout tree is null; single Launch button opening `LaunchDialog`. |
| `src/renderer/src/components/LayoutRenderer.vue` | Enable split buttons; relay the split event upward. **Leave the "Session no longer exists" placeholder branch intact** — F4 makes it more likely, not less. |
| `src/renderer/src/App.vue` | Add the `v-else` arm that renders `EmptyState` when `layout.tree` is null (today a null tree renders **nothing**); host `LaunchDialog` and own its open/close + split-target state. |
| `src/main/index.ts` | **(D11)** Wire `storage.updateSessionStatus(id, 'exited', exitCode)` into `watchSessionExits` so DB status stops lying. Scope admitted deliberately — see the D11 note below. |
| `src/renderer/src/components/TerminalPane.vue` | **Rekey all store reads/writes from `props.agent` to `props.sessionId`** (D10 — see above); split (H/V) buttons enabled, emitting `{targetSessionId, direction}` to open the dialog; **drop the `isLastLeaf` close-guard** (and its `collectSessionIds` import) so the final pane can close to the empty state. |
| `src/renderer/src/stores/layout.ts` | Apply `splitPane` on launch success; **remove `removeLeaf`'s null early-return** so the last close sets `tree = null` and persists the layout's absence; keep the plain-snapshot persist (D14). |
| `src/renderer/src/stores/session.ts` | **Rekey `Record<AgentKind, PaneSessionState>` → `Record<string /* sessionId */, PaneSessionState>` (D10);** entries created on attach/launch rather than pre-seeded; `agent` moves into the state object; `attached`/`exited`/`setBusy`/`dotStatus` take a `sessionId`. Insert the new session snapshot on launch. |
| `src/shared/layout.ts` | Only if a helper for "tree is empty/null" is genuinely absent — otherwise leave untouched. |

If a change appears to need a file not in this table, stop and raise it rather than expanding scope.

### D11 — why `src/main/index.ts` is in scope

Tasks 1-2 and 1-3 both carried "do not touch `main/index.ts`" as a non-goal, which is why `storage.updateSessionStatus` has existed since 1-2 with **no caller**. DB `status` is therefore still whatever the row was born with — Task 1-3 confirmed the concrete symptom (F4): close a pane and its `sessions` row lingers at `status='running'` forever.

This task is where that stops being harmless, because it is the first task whose sessions are user-created rather than seeded. Wiring is one call inside the existing `watchSessionExits` handler. **`src/main/index.ts` is admitted to scope for that single purpose** — no other changes to the file.

### F4 — session rows and leaves drift apart

A session row can outlive its leaf (close-pane) and, after this task, a leaf can reference a session whose PTY is long dead (restart with no relaunch). Neither is corruption; both are normal. Anything reading the two together must tolerate the mismatch in **both** directions — `LayoutRenderer`'s "Session no longer exists" placeholder is the renderer half of that contract and stays. Full reconciliation is Task 1-5's restore work, not this task's.

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
0. **Session store rekey (D10) — do this first, verify, then continue.** Change `stores/session.ts` from two fixed agent slots to a `sessionId`-keyed record: `PaneSessionState` gains an `agent: AgentKind` field, `detached()` seeding disappears (entries are created by `attached()`/launch), and `attached` / `exited` / `setBusy` / `dotStatus` all take a `sessionId`. Update every call site in `TerminalPane.vue` (`store.sessions[props.agent]` → `store.sessions[props.sessionId]`, and likewise `dotStatus` / `setBusy` / `attached` / `exited`). Run `npm run typecheck` and `npm run dev` at this point: the app must look and behave **exactly as before** with two panes — a pure refactor, zero visual change. Only then start the launch flow.
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
11. **Wire `updateSessionStatus` (D11).** In `watchSessionExits` (`src/main/index.ts`), call `storage.updateSessionStatus(sessionId, 'exited', exitCode)` when a PTY exits. One call; no other change to that file. Verify by dumping the `sessions` row after a Kill.

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
- [ ] Store rekey (D10) landed first as a standalone pure refactor: `typecheck` green and the two-pane app visually unchanged **before** any launch-flow code.
- [ ] Split the Codex pane H and launch Codex again → **three panes, two independent Codex TUIs**, each interactive (the multi-session-per-kind proof — screenshot per G2).
- [ ] With two Codex panes live, the sessions are provably independent: killing one turns **only** that pane's dot red/gray and disables **only** its buttons; the other keeps running and stays interactive.
- [ ] `cwd` that does not exist or is not absolute is rejected with an inline dialog error; no session row is created.
- [ ] Undetected agents appear disabled with a "not found" note.
- [ ] `recent_cwds` persists across launches, deduped, capped at 10.
- [ ] Closing the last pane returns to the empty state; the `pane_layouts` row is gone. (Requires both 1-3 guards removed — `isLastLeaf` and `removeLeaf`'s null early-return.)
- [ ] **No `An object could not be cloned` error** in the renderer console across the full flow — launch, split-launch, close, last-close (D14). Check the console explicitly; this failure is runtime-only and easy to miss if a payload merely *looks* right.
- [ ] After a Kill or a pane close, the `sessions` row shows `status='exited'` with the real `exit_code` (D11 wiring proved by a DB dump, not by inspection of the code).
- [ ] An existing dev DB still opens (legacy conversion path unbroken).
- [ ] One narrated commit for this execution session (G3), touching only the files in Exact Scope.

## Review Checklist
- [ ] All Zod validation is in **main**; preload and renderer stay Zod-free (D1, CSP).
- [ ] `cwd` validated in main via `path.isAbsolute` + `fs.existsSync` before any spawn (security boundary).
- [ ] No CLI flags added; bare launch stays bare; flags (if any touched) verified against `--help`, not memory (D4).
- [ ] No secrets/keys in args, logs, or transcripts (unchanged; confirm nothing new logs `cwd`-adjacent env).
- [ ] SessionManager still owns spawning; renderer never spawns a process (D3).
- [ ] No `AgentKind`-keyed session state survives anywhere in the renderer — grep for `sessions[` and for `props.agent` in `TerminalPane.vue`; `agent` may be *read* for labels/icons but must never be a **key** into session state (D10).
- [ ] `attach` no longer respawns dead sessions; Restart owns respawn.
- [ ] Legacy DB conversion path untouched.
- [ ] Every renderer→main payload is a plain object, not a Pinia/reactive proxy (D14).
- [ ] `src/main/index.ts` changed **only** to wire `updateSessionStatus` (D11) — nothing else in that file.
- [ ] `LayoutRenderer`'s missing-session placeholder branch still present (F4).
- [ ] No untracked/`docs/` files staged or reverted.

# Task 3-4 — First Real Settings View

_Fourth task of Phase 3 (Foundation). Windows-only. **One commit** (G3). This task governs scope; `ImplementationSpec-3-4.md` governs exact contents. **Renderer-only** — no main-process file is touched._

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — the phase contract, cross-cutting rules, gates, file-ownership matrix.
- Roadmap §6 **D29** (Phase 3 ships Chorus's first real Settings view; `App.vue` gains a workspace ⇄ settings switch — Chorus's first navigation concept, which Phase 3b's council configuration UI inherits rather than reinventing).
- Roadmap §6 **D33** clause 3 — **write-only inbound IPC**. This task is where that clause meets a text input, and it is the only place in the phase where a human types a real key.
- Roadmap §5 **F13** — async `onMounted` continuations must bail after every `await` when the component may have unmounted.
- Roadmap §6 **D21** — the palette registry is extensible; new commands are added there, not bolted onto `App.vue`.
- Task 3-2's channels (`provider:*`, `credential:*`) and Task 3-3's `adapter:list` are the entire data surface. **This task adds no channel.**
- Precedent: `WorktreePanel.vue` (2-3) for a list-plus-destructive-action surface; `LaunchDialog.vue` for the form idiom and focus trap; `stores/view.ts` (1b-2) for a small store with a supersede guard.

## Initial Starting Point

**Verified 2026-07-22 against commit `fb3201e`**; re-verify against 3-3's commit before starting.

- **Baseline at the time of writing:** typecheck 0 · 160/160 across 8 files · `grep:secrets` clean. Tasks 3-2 and 3-3 add to this; the implementer confirms the then-current numbers rather than these.
- **There is no `src/renderer/src/views/` directory.** This task creates it. Every renderer component today lives in `components/`, every store in `stores/`.
- **`App.vue` has no navigation concept.** Its template is: a top bar (`ProjectTabs` + the filmstrip/grid toggle, hosted in `App.vue`'s own template), then `FilmstripRenderer` **or** `LayoutRenderer` **or** `EmptyState`, then the `LaunchDialog`, `CommandPalette`, and `WorktreePanel` overlays. The view switch this task adds is the first thing that swaps the *whole* main region.
- **The overlay idiom is not being abandoned** (D29): `LaunchDialog.vue`, `CommandPalette.vue`, and `WorktreePanel.vue` stay overlays. Only durable configuration moves into a view.
- **Stores are Pinia, in `src/renderer/src/stores/`**: `layout.ts`, `view.ts`, `project.ts`, `session.ts`. `view.ts` is the closest model for this task — small state, an async `loadFor` with a **store-level supersede guard** (`loadSeq`), immediate plain-snapshot persistence, no debounce.
- **`palette/commands.ts`** is a pure registry module: `buildCommands(ctx: PaletteContext)` returns the five D21 command groups; `fuzzyFilter` returns only `enabled()` commands, so a disabled command simply does not render. `App.vue`'s `paletteCommands` computed assembles the context.
- **D14 is live and unforgiving:** anything store-sourced must be snapshotted (`JSON.parse(JSON.stringify(x))`) before crossing the bridge, or structured clone throws at runtime with no compile-time signal.

## Goal

Give Chorus a place to configure providers and credentials, and make the write-only rule visible in the UI rather than merely true in the IPC layer.

The interesting constraint is not the CRUD — it is that **this screen can never show the user what they typed**. Every other settings screen anyone has built displays the current value of the thing being edited. This one cannot: D33 clause 3 admits no read path, and resolution (b) removed fingerprints from IPC, so there is not even a hash to show. A credential profile renders as a label, a provider, a creation date, and a health state — and that is the complete set of facts the renderer is permitted to know.

That constraint has a real UX consequence the implementer must design *for* rather than around: a user who forgets which key they stored cannot check, only replace. The mandatory label is what carries that weight (it is why D33(b) made it mandatory), so the create form should push the user toward a descriptive one rather than accepting `key1`.

## Exact Scope

| File | Change |
|---|---|
| `src/renderer/src/views/SettingsView.vue` | **Create.** The view shell: header, section nav, and the two panels. |
| `src/renderer/src/views/SettingsProviders.vue` | **Create.** Provider list + create/edit/delete form. |
| `src/renderer/src/views/SettingsCredentials.vue` | **Create.** Credential profile list + create/replace/delete. The write-only surface. |
| `src/renderer/src/stores/settings.ts` | **Create.** Pinia store holding providers, profiles, and adapter descriptors; load/create/replace/delete actions. **Never holds a plaintext key.** |
| `src/renderer/src/stores/settings.test.ts` | **Create.** Unit tests for the pure parts (see Test Expectations). |
| `src/renderer/src/App.vue` | **Edit.** The workspace ⇄ settings view switch and its top-bar control. |
| `src/renderer/src/palette/commands.ts` | **Edit.** An "Open settings" command in the D21 registry. |
| `src/renderer/src/palette/commands.test.ts` | **Edit.** Cases for the new command. |

Nothing else. **No main-process file, no shared file, no preload file.** If the view seems to need a channel that does not exist, that is a finding to raise — not a reason to open `src/main/`.

## Non-Goals

- **No new IPC channel, no schema change, no main-process change.** 3-2 and 3-3 shipped the surface. If something is missing, raise it rather than adding it here — a renderer task that edits main is unreviewable as a renderer task.
- **No key is ever displayed, echoed, masked, previewed, or logged.** No `sk-ant-…AB12` hint. No character count. No "key set ✓" derived from the key itself rather than from the row's existence. No `console.log` of a form value.
- **No plaintext key in Pinia, ever** — not transiently, not in a `ref` the store owns. The input's value lives in component-local state, crosses the bridge once, and is cleared. A Pinia store is devtools-inspectable.
- **No Test-key button.** Task 3-6 adds it, along with the probe it calls. A disabled placeholder button is also out — do not ship dead UI.
- **No injection, no launch-dialog change.** Task 3-6.
- **No settings beyond providers and credentials.** No theme, no font size, no keybindings, no "general" tab. The view is a container that Phase 3b and later phases extend; filling it now is jumping ahead exactly as `CLAUDE.md` warns.
- **No routing library.** The switch is a `ref` and a `v-if`, matching how `viewStore.mode` already selects a renderer. Adding vue-router is a dependency ask nobody has made.
- **No change to the overlay components** (`LaunchDialog`, `CommandPalette`, `WorktreePanel`) — D29 keeps them overlays.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**
- **Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch.**

## Dependencies

- **Task 3-2** — `provider:*` and `credential:*` channels, and the `CredentialProfileMeta` shape this view renders.
- **Task 3-3** — `adapter:list`, which supplies the auth-method options and adapter display names in the provider form.
- No new npm dependency.

## Step-by-step Work

1. **`stores/settings.ts`** first — the data shape drives the components. Load providers, profiles, and adapters; expose create/replace/delete actions that call through `window.chorus` and refresh. Copy `view.ts`'s **supersede guard** pattern for the async load.
2. **`SettingsView.vue`** — the shell. Header with a "Back to workspace" affordance, a two-section layout, and the F13 bail discipline in `onMounted`.
3. **`SettingsProviders.vue`** — list + form. The adapter select and auth-mode select both come from `adapter:list`; `env_var_name` is an optional override with the adapter's default shown as the placeholder (a placeholder, not a pre-filled value — pre-filling would persist a copy of a default that should stay derived).
4. **`SettingsCredentials.vue`** — list + create form. This is the security-sensitive component; build it against §4 of the spec.
5. **`App.vue`** — the view switch. One `ref`, one `v-if` around the main region, one top-bar button. The top bar itself stays visible in both views so the user is never stranded.
6. **Palette command** — "Open settings" in `buildCommands`, following the existing group conventions and `enabled()` discipline.
7. **Tests**, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.
8. **Runtime-verify (G2)** per Verification Commands — especially the no-leak sweep, which is the acceptance gate for this task.

## Test Expectations

**Unit (Vitest), `src/renderer/src/stores/settings.test.ts`.** The store calls `window.chorus`, so tests stub it — the `view.test.ts` precedent. Test the logic, not the bridge:

- **The store never retains a key.** After a `createProfile(...)` action with a fake key argument, a **deep scan** of the store's own state (`JSON.stringify` of `$state`) contains no substring of that key. Write it as a scan rather than checking two named fields, so a future added field cannot quietly hold one.
- **Supersede guard:** two overlapping `load()` calls resolve in reverse order; the store ends holding the **later** call's data. This is the `view.ts` `loadSeq` bug class and the reason that guard exists.
- **Refresh-after-mutate:** each of create / replace / delete triggers exactly one reload, and a failed mutation (`{ok:false}`) does **not** clear or corrupt the existing list.
- **Failure surfacing:** an `{ok:false, reason}` response is exposed as a renderable error and does not throw.

**Unit (Vitest), `src/renderer/src/palette/commands.test.ts`:**

- The "Open settings" command is present, in the expected group, and its `enabled()` is true with and without an active project (settings are not project-scoped — if the implementer decides otherwise, that is a design change to flag, not to encode silently).
- `fuzzyFilter` surfaces it for a natural query (`'set'`).

**No test may contain a real credential.** Fake values of realistic shape only, and `npm run grep:secrets` must still pass.

**Runtime (G2)** carries the no-leak proof and the F13 proof — neither is establishable in a unit test.

## Verification Commands

Run from repo root (PowerShell):

```
npm run typecheck
```

```
npx vitest run
```

```
npm run grep:secrets
```

```
npm run dev
```

**The no-leak sweep is this task's acceptance gate.** With CDP attached and a planted fake key of realistic shape entered through the real form:

1. **Devtools DOM** — after submitting, `document.documentElement.outerHTML` contains no substring of the key. Check **after** the success state renders, not before.
2. **The input itself** — the field's `value` is empty after a successful create, and the form is not left holding it in a `ref`. Read the live value via CDP rather than trusting the visual.
3. **Pinia state** — evaluate the settings store's `$state` and assert the key is absent. Vue devtools exposes store state to anyone with the window open; this is the check that proves it is not there to expose.
4. **Every IPC response** — dump the full JSON of `credential:list`, `provider:list`, and the create response. No key material, no 64-hex fingerprint.
5. **The main-process log** — no key, no fingerprint.
6. **Reload the window** (`Ctrl+R` or CDP `Page.reload`) and confirm the profile still lists **and the key is still unrecoverable** — the point being that persistence and secrecy coexist.

**F13 proof:** open the settings view and switch back to the workspace **before** the initial loads resolve (throttle via CDP network conditions, or simply click fast on a cold boot). Expected: no unhandled rejection, no `null` property access in the console, and no listener left registered. This is the exact failure `de98679` fixed in `TerminalPane` and it is a real risk in any component with awaits in `onMounted`.

**Empty-state proof:** with zero providers and zero profiles in the DB, the view renders a sensible empty state rather than a broken list or a spinner that never resolves.

**⚠ The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` dump-script pattern (`_verify/2-1-dump.js`); write results to a file; **known flake: no file on first invocation, retry once**; **quote the `projects` table** (F20).

**Harness reminders:** electron-vite HMR covers the **renderer only** — renderer changes hot-reload, but any check that involves main needs a real cold boot. Kill process **trees** (`taskkill /PID <root> /T /F`). CDP on `--remote-debugging-port=9222`; wrap `Runtime.evaluate` bodies in IIFEs (top-level `const` collides across evaluates).

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green, the then-current baseline intact and grown.
- [ ] `npm run grep:secrets` — clean (G4).
- [ ] **A provider can be created, edited, and deleted** from the app; deleting one that still has credential profiles surfaces 3-2's structured refusal inline, not an exception.
- [ ] **A credential profile can be created, replaced, and deleted** from the app, and the list reflects each change without a manual refresh.
- [ ] **The key is unrecoverable, proven six ways** (DOM, live input value, Pinia state, IPC responses, main log, and after a window reload) — the sweep above, with results quoted.
- [ ] **No plaintext key exists in any Pinia store at any point** — proven by the unit test's deep scan *and* the runtime `$state` dump.
- [ ] **The auth-method and adapter options come from `adapter:list`**, not from hardcoded strings — grep-verified: no `'Claude Code'`, `'claude'`, or `'api_key'` string literals driving UI choices in the new files.
- [ ] **Unavailable profiles render as unavailable** (3-2's `unavailableSince`) with an actionable message, rather than looking identical to healthy ones.
- [ ] **The view switch works both ways**, the top bar stays reachable in both, and the workspace's terminal panes are **not** destroyed by switching to settings and back — a session must survive the round trip with its scrollback intact.
- [ ] **F13 discipline:** every `await` in an `onMounted` is followed by an unmount check, and the fast-switch test produces no console error.
- [ ] The palette's "Open settings" command opens the view.
- [ ] **No main-process, shared, or preload file is touched** — grep the diff.
- [ ] **One** narrated commit (G3), touching only the Exact Scope files.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch are **untouched**.

## Review Checklist

- [ ] Read the credential component looking specifically for a read path: a `v-model` bound to something the store owns, a success response destructured into a `ref`, a debug `console.log`, an error message that interpolates the submitted value. Any one of them is a clause-3 breach.
- [ ] The key input is `type="password"`, has `autocomplete="off"`, and is cleared on success **and** on component unmount.
- [ ] The store's deep-scan test would actually fail if a key were retained — check by temporarily retaining one and watching the test go red (test the test), then revert.
- [ ] Switching to settings and back does **not** remount the terminal panes. If it does, the `v-if` is placed too high in the tree — F5's remount hazard is resolved but pane remounts still cost scrollback and re-attach churn.
- [ ] The empty state was actually exercised, not reasoned about.
- [ ] The provider form's `env_var_name` placeholder shows the adapter default without persisting it, so a later adapter change still propagates.
- [ ] Nothing in this task widens the IPC surface, and nothing in it reaches into `src/main/`.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.

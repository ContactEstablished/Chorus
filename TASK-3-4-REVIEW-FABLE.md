# Task 3-4 — Execution Report for Review (Fable)

**Status: DONE** — both commits landed, all gates green, the six-way no-leak sweep executed against the live window, and both test-the-test demonstrations shown red then green.

_This file is untracked working-copy material for review — it is not part of either commit and should not be committed (the D37 session's two commits contain source files only)._

- **Commit 1 (chore, D37/F25): `e8d4e85`** — `layout:get` tolerates unknown-agent rows (one file: `src/main/ipc.ts`).
- **Commit 2 (task, D29): `899df07`** — the Settings view (renderer-only; 8 files, 1150 insertions).
- Base: `62fc236` (Task 3-3). Branch `main`, unsquashed, no push/PR/amend/rebase.

---

## 1. Environment statement (F20)

This session's DB is the **redirected-AppData DB**: `projects` = `a43b395d-51e2-47d3-8043-cb7b56094fca` ("Chorus") / `b684e96e-2a50-409e-b6ce-0c3570142c31` ("Chorus-Second") — quoted in every dump (`_verify/3-4/dump-baseline.json`, `dump-post-restore.json`, `dump-final.json`). The coordinator re-verifies against the real dev DB (`985d547b…`/`f47ac10b…`).

The hand-edited F25 row (`1d157eb6-ba15-4b91-8a71-ca54bee9cba2`, agent `codex` → planted `'gemini'` → **restored to `codex`**) is proven in `_verify/3-4/set-agent-plant.json`, `set-agent-restore.json`, and `dump-post-restore.json`.

## 2. Chore evidence (F25, commit 1)

Cold boot with the planted `'gemini'` row:

- `layout:get` **succeeded** over CDP; the response's `sessions[]` carried 12 of the project's 13 rows — the planted row omitted, healthy sessions (incl. both Claude rows) intact; the **tree passed through untouched** (the `1d157eb6` leaf still present). Artifact: `_verify/3-4/layoutget-result.json`.
- Pino warn, one per dropped row per invoke, naming row id + value: `[layout] layout:get dropping session row 1d157eb6-…: unknown agent 'gemini'` (`_verify/3-4/boot-f25.log`, two lines — boot load + CDP-driven invoke).
- **No uncaught rejection**: a full `Page.reload` with the bogus row in place produced zero exceptions and zero console errors (`_verify/3-4/console-reload.json`).
- Placeholder ("Session no longer exists") rendered in **both** view modes — grid (`f25-grid.png`, DOM count 1) and filmstrip after focusing the `Unknown` card (`f25-filmstrip.png`, DOM count 1). Artifacts: `dom-grid.json`, `dom-filmstrip.json`.
- Row restored and dump-proven (above). Gates after the edit: typecheck 0, 224/224, grep:secrets clean.

## 3. The six-way no-leak sweep (acceptance gate)

Planted keys: three session-generated fakes of realistic shape — `sk-ant-api03-` + 43 base62 chars (56 chars total; confirmed to match the `sk-ant-[A-Za-z0-9_-]{20,}` scrubber/gate pattern). Values never appear in this report; they lived in `_verify/3-4/keys.json`, **purged** before the final `grep:secrets`. Leak assertions scanned for the whole key, every 8-char slice, and any 64-hex run (fingerprint leak). All records in `_verify/3-4/leak-checks.jsonl` (121 lines, key-free).

After a **real form submission** of planted key 1:

| # | Surface | Result | Artifact |
|---|---|---|---|
| (a) | `document.documentElement.outerHTML` (41 KB), captured **after** the success state rendered | no key, no 8-char slice, no 64-hex run — **pass** | `sweep-a-dom.html` |
| (b) | live password input post-success | form closes on success; re-opened form reads `""` — **pass** | `sweep-acd-meta.json` |
| (c) | settings store `$state`, reached via the dev-mode `__vue_app__` handle (**no accessor added or shipped** — the commit diff has none) | clean — **pass** | `sweep-c-state.json` |
| (d) | every IPC response dumped verbatim: `adapter:list`, `provider:list`, `credential:list`, `provider:create`, `credential:create` | no key material, no 64-hex run; create returns `{ok:true,id}` only — **pass** | `sweep-d-ipc.json` |
| (e) | the main-process log (whole boot) | clean — **pass** | `boot-main.log` |
| (f) | `Page.reload` → profiles still list **and** DOM + `$state` re-scanned clean; reload produced zero exceptions/console errors | persistence and secrecy coexist — **pass** | `sweep-f-dom.html`, `sweep-f-state.json`, `f-reload-console.json` |

## 4. Test-the-test (spec §7.2)

One sabotage line in `settings.ts::createProfile` retaining the key in `$state` (never committed — verified absent from `899df07`):

- **Unit deep-scan: RED** — `1 failed | 6 passed`; the failing assertion is the `$state` substring scan.
- **Runtime scan (c): RED** — `keyHits: ["key1"]` (full-key hit in serialized `$state`; the `key2@0/key3@0` slice hits are the shared `sk-ant-a` prefix artifact of the retained key1, not key2/key3 retention).
- **After revert: both GREEN** — 7/7 store tests; runtime scan clean after a window reload.
- Harness lesson: the runtime RED required a **page reload** — the running app kept the pre-sabotage store implementation under electron-vite HMR (Pinia stores don't hot-swap without `acceptHMRUpdate`). The first post-HMR scan was a false green, caught and corrected. Evidence: `leak-checks.jsonl` (RED and GREEN records), `sabotage-reload-console.json`.

## 5. F13 evidence

25 rapid settings open → workspace cycles (~30 ms apart, loads racing the unmount): **zero exceptions, zero unhandled rejections**, view fully functional afterwards (`f13-fastswitch.json`). `SettingsView` registers the `alive` flag before the first await, bails after every await, and the Esc listener mounts/unmounts with the view. CDP network throttling was considered and rejected as a lever: renderer IPC does not traverse the network stack, so rapid cycling is the honest stressor.

## 6. Round-trip evidence (view switch)

Typed-marker proof in grid mode: `CHORUS34MARKER` written into the **running** Claude session `ea3f2afe…` → visible before; panes unmounted in settings (no `.xterm` in DOM — by design, PTYs live in main); visible after returning (`marker-roundtrip.json`). Prompt text cleared afterwards (Ctrl+U). The switch itself was exercised four ways: top-bar button both directions, Esc-from-settings, palette `Ctrl+K → 'set' → Enter`, and Esc with the palette open **above** settings closing the palette and **not** the view (`esc-yield.json`, `esc-yield2.json`, `palette-open.json`).

## 7. CRUD walk-through (all through the real UI)

- **Provider create**: adapter select byte-identical to `adapter:list` (`adapterSelectMatchesWire: true`); auth-mode options = the selected adapter's `authMethods`; `env_var_name` input **empty** with placeholder `ANTHROPIC_API_KEY` = the wire default — **not** persisted (`provider-create.json`).
- **Provider edit**: prefill correct, rename saved (`provider-edit-cred.json` — *purged*: it captured the stale pre-submit input value, see §10).
- **Provider delete with profiles**: inline structured refusal, verbatim: *"Provider 'VerifyProvider-Edited' still has 2 credential profiles — delete them first"* (`provider-delete-refusal.json/.png`). No pre-disabling; main is the authority.
- **Credential create**: password input `type="password"`, `autocomplete="off"`, `spellcheck="false"` (DOM-verified).
- **Credential replace — D36 duplicate refusal**, inline and verbatim: *"That key is already stored as credential profile 'verify-key-1'."* — form stays open, field not cleared on failure (`dup-retry.json`, `duplicate-refusal2.png`). DB fingerprint dump confirmed the refused replace did **not** write.
- **Unavailable state (F-5a)**: row SQL-marked + blob-corrupted (`mark-unavailable.json`) → distinct actionable rendering (red dot, *"unavailable since just now — re-enter the credential"*, amber replace) — not a healthy row with a subtitle (`unavailable-render.json`, `unavailable-state.png`). A **form replace cleared it**: DOM back to healthy, `unavailable_since` NULL, blob re-encrypted in the DB (`fingerprints-post-replace.json`).
- **Deletes**: 4 profiles + 2 providers deleted **through the UI**; `provider_configs` / `credential_profiles` **empty again**; the empty state returned (`cleanup.json`, `cleanup-empty.png`, `dump-final.json`).
- **Empty state** (zero providers): honest placeholder, no stuck spinner, captured **before** anything was created (`empty-state.png/.json`).
- **Console hygiene** across every reload: zero exceptions, zero console errors, zero clone errors.

## 8. Grep gates (§10)

| Gate | Result |
|---|---|
| `git diff --name-only 62fc236 -- src/main src/preload src/shared` | **only `src/main/ipc.ts`** (commit 1) |
| `git grep "console\." -- src/renderer/src/views …/stores/settings.ts` | 0 hits |
| `git grep -E "sk-ant\|sk-or\|sk-proj\|AKIA" -- src/renderer` | 0 hits |
| `git grep "KeepAlive" -- src/renderer` | 0 hits (one comment hit during development, reworded before commit) |
| Acceptance-criteria literal grep (`'Claude Code'`, `'claude'`, `'codex'`, `'api_key'`, `'subscription'`) in the new files | 0 hits — every option is wire-sourced |

## 9. Files changed

**Commit 1 (`e8d4e85`)**: `src/main/ipc.ts` — the `layout:get` projection filter + warn (D37).

**Commit 2 (`899df07`)**: create `views/SettingsView.vue` (D38 shell, F13 discipline, Esc-yield), `views/SettingsProviders.vue` (grouped cards, provider CRUD), `views/SettingsCredentials.vue` (the write-only surface), `stores/settings.ts` (supersede-guarded store; **no `key` field, stated in a comment**), `stores/settings.test.ts` (7 tests incl. the deep scan); edit `App.vue` (the view switch; **load watcher untouched**), `palette/commands.ts` (`settings.open`, always enabled), `palette/commands.test.ts` (+4 tests). Nothing outside §7's tables.

**Verification transcript**: `npm run typecheck` 0 errors · `npx vitest run` **235/235 across 11 files** (224 baseline + 7 settings + 4 palette) · `npm run grep:secrets` clean **after** the sweep and the planted-key purge · runtime items 1–9 individually evidenced above.

## 10. Findings, concerns, and proposals

1. **(Concern — docs inconsistency, proposal to reword)** `Task-3-4.md`'s Review Checklist says "Switching to settings and back does **not** remount the terminal panes," while spec §1 and the acceptance criteria say panes **will** unmount on the switch and scrollback survival is the proof. I implemented and verified the latter (marker round-trip). The checklist line only makes sense as targeting *spurious in-workspace* remounts (a `v-if` placed too high — mine wraps the main region only; the top bar never remounts). **Proposal: reword the checklist line** so 3b's implementer doesn't read it as a `<KeepAlive>` demand — the docs already (correctly) forbid that.
2. **(Finding — spec sketch drift, already known in part)** Two more spec-vs-shipped mismatches beyond the ratified `listCredentials` naming: spec §6's palette sketch carries a `group: 'Application'` field that **does not exist** on `PaletteCommand` (the registry has no group concept; the command is simply the last `buildCommands` entry, and the test asserts presence/label/enabled/fuzzy instead). **Proposal: amend the spec sketches** so 3-5/3-6 don't re-trip on them.
3. **(Concern — Esc-yield is prop-based)** The settings Esc handler yields by reading `overlayOpen`, a computed in `App.vue` OR-ing the three overlay flags. It works (proven with the palette above settings), but a **future overlay that forgets to join `anyOverlayOpen` reintroduces the conflict silently**. Proposal for 3b/3c: when more overlays arrive, centralize overlay-open state rather than growing the OR-chain.
4. **(Finding — registry/enum coupling in the F25 fix)** The projection filter treats `getAdapter(row.agent)` membership as proof of `agentKindSchema` validity — true today because `staticRegistry` is keyed by `AgentKind` (noted in a code comment). If Phase 6's registration seam ever admits an adapter id outside the enum, the filter would keep a row the outbound parse then rejects — reintroducing F25 exactly. **Proposal: Phase 6 must widen the enum and the registry together** (or derive one from the other); worth a line in the Phase 6 docs now.
5. **(Note for 3-6)** `lastVerifiedAt` renders ("never verified" today) and `unavailableSince` clears on replace — both re-render from the store's post-mutation reload, so the Test-key probe only needs to update the row; no store or component change is required for the timestamps to flow. The Test-key button slots into the credential row's existing actions cell; no layout rework.
6. **(Note for 3-5)** The view switch unmounts all panes while `session:data` keeps streaming in main — the scrubber's non-interference checks should include a workspace ⇄ settings round trip in their matrix (implicitly exercised here by the marker proof: the PTY kept running and the replay was byte-faithful).
7. **(Concern — security ergonomics, by design but worth visibility)** D36's duplicate refusal (*"That key is already stored as credential profile 'X'"*) is an **oracle**: it confirms to anyone at the keyboard that a guessed key is in use, and names the profile holding it. Ratified behavior (D36), rendered verbatim as instructed — flagged only so the trade-off is consciously re-accepted, since this screen is where that message meets a real key for the first time.
8. **(Minor — harness, not product)** Driving Vue forms over CDP needs a microtask tick between `input` events and clicking submit, or the click lands on a stale `:disabled` and is swallowed. One early "failed" create was exactly this; the retry succeeded. Recorded so the next harness author doesn't read it as an app bug.
9. **(Cosmetic — own commit message)** Commit 1's message contains one garbled sentence ("11 -> 11 of 12… 12 rows in") from an editing slip; the numbers it meant: 13 rows for the project, 12 in the response, the planted one omitted (as `layoutget-result.json` shows). Amending is forbidden by the task; noted here for the record.
10. **(Confirmation — purge discipline)** 11 `_verify/3-4` files carried planted-key material (eval scripts with interpolated keys, `keys.json`, two result/state captures — including the RED test-the-test artifact, whose proof survives as the key-free `leak-checks.jsonl` record). All 11 deleted; `grep:secrets` re-run **after** the purge: clean. `SCAN_DIRS` untouched.

## 11. Acceptance criteria (Task-3-4.md), restated

- typecheck 0 — **pass** · vitest green and grown (235/235) — **pass** · grep:secrets clean — **pass**
- Provider create/edit/delete; delete-with-profiles refusal inline — **pass (§7)**
- Credential create/replace/delete; list reflects each change without manual refresh — **pass (§7)**
- Key unrecoverable six ways — **pass (§3)** · no plaintext key in Pinia, unit + runtime — **pass (§3c, §4)**
- Adapter/auth options from `adapter:list`, grep-verified — **pass (§7, §8)**
- Unavailable renders distinct + actionable — **pass (§7)**
- View switch both ways, top bar reachable, session survives with scrollback — **pass (§6)**
- F13 discipline + fast-switch run — **pass (§5)** · palette command opens settings — **pass (§6)**
- No main/shared/preload file touched in commit 2 — **pass (§8 gate 1)**
- Two commits (D37 ratification), only Exact Scope files — **pass** · worktree fixture untouched — **pass (`dump-final.json`: `chorus/Chorus/24b5c1fe` detached, plus the two pre-existing detached rows of this DB)**

**Phase-3-Overview Settings box**: providers and credential profiles creatable/listable/deletable from the app; a stored key never rendered, never returned over IPC, never read back after entry — **pass**.

**Non-goals**: no new channel/schema; no main/preload/shared edit in commit 2 (gate quoted §8); no key display of any kind (no hint column — the mock's mask stayed unbuilt, D33 wins); no Test-key button and no disabled placeholder; no launch-dialog/injection change; no scrubber work; no extra settings tabs or dead nav entries; no visual-system adoption; no vue-router/new dependency; no overlay-component edits; no `unavailable_since` semantics change; no `window.confirm`; no `KeepAlive`; fixture and `docs/` untouched.

## 12. Final git output

```
 M docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-4.md
 M docs/Features/Foundation/Tasks/Phase-3-Overview.md
 M docs/Features/Foundation/Tasks/Task-3-4.md
 M docs/Features/Foundation/roadmap.md
?? docs/Features/Foundation/Tasks/Task-3-4-ExecutionPrompt.md
?? docs/design/
```

```
899df07 Task 3-4: First real Settings view (D29) — providers & write-only keys
e8d4e85 Task 3-4 chore (D37): layout:get tolerates unknown-agent rows (F25)
62fc236 Task 3-3: AgentAdapter interface + capabilities + launch-path refactor (D34) — zero behavior change
46ad9b7 Task 3-3 chore: close F24, F-4, F-5b — three small 3-2-review hardenings (D36)
af4ff17 Additional Phase 3 docs
```

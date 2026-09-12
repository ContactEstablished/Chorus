# Task 10.1-1 — One launch composition, every caller (closes F115)

**Phase:** Engine 10.1 · **Depends on:** None · **Owns:** `src/main/services/launchOptionsCore.ts`,
`launchOptionsCore.test.ts`, plus call sites in `ipc.ts`, `sessionManager.ts` and `index.ts`

---

## Source Of Truth

- `docs/Features/Engine/chorus-engine-spec.md` — **§3.7** (F115), **§5 Phase 10.1** bullet 4 ("Close
  **F115** first"), and §5's **Files:** line, which names `sessionManager.ts:600` and `ipc.ts:2258`;
  `GROUND-FACTS-10.1.md` (kickoff, 2026-09-12) — the verified-line-number table.
- Convention: `src/main/services/launchProfiles.ts` — the decidable half lives in a pure module that
  takes its row lookups as **callbacks** (`sessionIsCredentialed` at `:127` is the exact precedent).

## Initial Starting Point (verified 2026-09-12 at `3e391a0`)

Four code paths start a PTY. **Two compose launch options in full; two compose none.** The spec says
three — ⚠ **it undercounts, and the missed one is the original of the duplicated block:**

| # | Path | Site | Composes |
|---|---|---|---|
| 1 | `session:launch` (fresh) | `ipc.ts:1816-1843`, credential block `:1887-1895` | ✅ full, payload-over-profile |
| 2 | `session:relaunch` | `ipc.ts:3237-3255`, credential block `:3256-3272` | ✅ full, profile only |
| 3 | `session:restart` | `ipc.ts:2258-2265` | ❌ `conversationBoundary: 'restart'` and nothing else |
| 4 | boot / lazy restore | `sessionManager.ts:600` | ❌ nothing — `this.spawn(row.agent as AgentKind, row.cwd, row.id)` |

✅ Sites 1 and 2 are near-identical copies — same four `Pick<LaunchOptions, …>` slices, same spread
order, same credential block; site 1 differs only by `req.x ?? profileX` overrides.

✅ **What a restored or restarted pane actually loses:** `effort`, `modelEffort`, `permissionMode`,
`envAdditions`. The sharpest is `permissionMode` — absent does not mean "no flag", it means the
adapter's declared default (`sessionManager.ts:205-212`), and claude's is `defaultLevelId: 'auto'`
(`claude.ts:540`). **A pane the user launched in Plan or Manual comes back at the next boot in Auto.**
A silent widening of what the agent may do unasked, and the part of F115 that bites before Phase 10.

⚠ **THE SPEC AND THE BRIEF ARE BOTH WRONG ABOUT BYOK, AND THE TRUTH IS BETTER.** A restored or
restarted pane does **not** silently lose its credential and route — a credentialed session never
reaches either spawn. Restore heals it (`sessionManager.ts:571` reads `getCredentialedSessionIds`;
`:575-584` flips the row to `exited` titled *"Credential not re-supplied — relaunch from the dialog
to re-enter it"*); restart refuses it inline (`ipc.ts:2238`, message at `:2242`). Both use
`sessionIsCredentialed` (`launchProfiles.ts:127-138`), **fail-safe true** on an unresolvable pointer.
So: **a BYOK pane does not lose its key on restore — it loses the launch, by design (D33, no
unattended decryption).** Not a bug this task fixes; an invariant it must not break — and the fact
that makes the design below work. ✅ `Phase-10.1-Overview.md` carried the same wrong claim and **was corrected at the review gate,
2026-09-12** — it now states the heal/refuse behaviour and the zero-vault-references invariant. Left
recorded here because the claim came from the spec and will be re-derived by anyone who reads §3.7
without reading this.

✅ Other measured facts: `LaunchOptions` `sessionManager.ts:158`; `launch()` `:491` and `spawn()`
`:824`, both `opts: LaunchOptions = {}`; `restore()` `:526` already `async`; `RESTORE_CAP = 16` `:62`;
`resolveLaunchProfile` `launchProfiles.ts:222` → `ResolvedLaunchPlan` `:144`; `resolveCredential`
`ipc.ts:1292`, `async`, the only caller of `vault.decryptForLaunch` on a launch path.

⚠ **Three stale citations already in the tree**, all naming the site this task edits:
`sessionManager.ts:209` says restore is at `:474`, `:890` says `:395`, `:982` says `:395–:400`. It is
`:600`. Do not add a fourth — cite behaviour, not line numbers, in new comments.

## Goal

Give "the options a session launches with" exactly one definition and call it from every path that
starts a PTY, so a restored or restarted pane comes back with the effort, model effort, permission
mode and env additions it launched with. Closes F115.

## Exact Scope

1. **New** `src/main/services/launchOptionsCore.ts` — `composeLaunchOptions`,
   `makeLaunchOptionsResolver`, `LaunchOptionsResolver`. Pure: no `electron`, `node:fs`, `storage`,
   `vault`, `logger` or clock; lookups and the degrade report arrive as callbacks.
2. **New** `src/main/services/launchOptionsCore.test.ts`. No other new file.
3. `sessionManager.ts` — one private field, one `bindLaunchOptions(resolver)` method beside
   `bindStorage` (`:341`) / `bindHooks` (`:349`), and `:600` becomes
   `this.spawn(row.agent as AgentKind, row.cwd, row.id, this.launchOptions?.(row) ?? {})`.
   Update the now-false docstring at `:485-489` and the parenthetical at `:205-212`.
4. `index.ts` — one `sessions.bindLaunchOptions(...)` beside the six existing binds
   (`:541`, `:571`, `:597`, `:620`, `:625`, `:657`). It MUST precede `sessions.restore(...)` at `:1348`.
5. `ipc.ts` — `session:restart` (`:2258`) and `session:relaunch` (`:3237-3255`) call the shared
   function; `session:launch` (`:1816-1843`) calls it with the payload overrides. The two credential
   blocks (`:1887-1895`, `:3256-3272`) stay where they are.

## Non-Goals
- **No ledger code, no `schema.ts` / `storage.ts` DDL, no migration v24, no UI, no new IPC channel** —
  `npx vitest run src/shared/ipc.test.ts` stays green without touching its channel-count assertions.
- **No change to `mergeWiringEnv`'s precedence** (`ipc.ts:1189-1204`). See the trap below.
- **No `withMcpEnv` on the restore path.** Relaunch wraps its options in it (`ipc.ts:3287`); restore
  must not start to — it can start a Docker container (`ipc.ts:1000 memory.ensureStartedForLaunch`)
  on a bounded 15 s + 5 s budget, and with `RESTORE_CAP = 16` that is a boot-time worst case of
  sixteen such waits behind the first paint. Follow-on work; do not smuggle it in.
- **No credential resolution reachable from `SessionManager`** — `sessionManager.ts:567` states the
  file holds zero references to the vault, and it must still hold zero when this lands.
- **No change to which sessions restore**: the credentialed heal at `:575-584`, the `RESTORE_CAP`
  tail, the cwd guard and the stagger are untouched.
- Do not revert or commit the pre-existing modified/untracked files listed in the ground facts.

⚠ **Live trap, recorded and deliberately left alone.** `mergeWiringEnv` (`ipc.ts:1189`) lets a launch
profile's own env **win** on a collision — `{ ...wiring.envAdditions, ...profileEnv }` at `:1203`,
with a `logger.warn` at `:1198` so the loss is visible rather than silent. After this task a restored
pane carries `envAdditions` for the first time, so the trap becomes reachable on a path it never was
before: a profile setting a variable the engine later needs would bypass the engine on every restored
pane, with only a log line to say so. **Phase 10.3 owns the decision; this task records it.**

## Dependencies

None. First task of Phase 10.1 and the gate the rest stands on — §5 says close F115 *before* the
measurement, because an A/B across a mixture of configured and default panes measures nothing.

## Step-by-step Work

1. **Write the pure composition.** `composeLaunchOptions(plan, overrides?)` takes the non-credential
   quarter of a `ResolvedLaunchPlan` and returns a `LaunchOptions` whose absent keys are **omitted,
   not set to `undefined`** — the spec explains why that is load-bearing here.
2. **Write the resolver factory.** `makeLaunchOptionsResolver(lookups, onDegrade)` returns a
   **synchronous** `(row) => LaunchOptions`. No profile → `{}`. Profile missing or
   `resolveLaunchProfile` refuses → `{}` **plus one `onDegrade` call**; restore has no UI to show a
   refusal in, and not bringing the pane back would be a worse regression than the bug being fixed.
3. **Bind it in `index.ts`**, beside the other five binds and above `sessions.restore(...)` at
   `:1348`. Unbound stays a legal steady state — same contract as `hooks` and `contextUsage`.
4. **Restore calls it** at `sessionManager.ts:600`. One line; nothing else in `restore()` moves.
5. **Restart calls it** at `ipc.ts:2258`: `{ ...launchOptionsFor(row), conversationBoundary: 'restart' }`.
   The boundary spreads **last** — this caller's own fact, not the profile's. D142's ordering note at
   `:2252-2255` is about `clearAgentSessionId`, which does not move.
6. **Relaunch calls it** — `ipc.ts:3237-3255` collapses to one call; `:3256-3272`'s credential block
   is unchanged and still spreads over the composed object.
7. **Fresh launch calls it** with overrides, replacing `:1816-1843`. ⚠ The one step touching a
   shipped, hot path; its criterion is byte-identical behaviour, not "looks equivalent".
8. **Correct the three comments that now lie:** `sessionManager.ts:485-489`, `:205-212`, `ipc.ts:1830-1831`.

## Test Expectations

New file `launchOptionsCore.test.ts`. **Honest split: composition and resolver are fully unit testable
given fake lookups; the wiring is not testable at all.** Cover:
- Every present/absent combination of the four fields produces the exact key set — assert
  `Object.keys(...).sort()`, not field-by-field, so a future field cannot appear unasserted (the
  `launchProfiles.test.ts` key-set discipline).
- An absent value is an **omitted key**, never `key: undefined`: `'effort' in opts === false`. An
  empty `envAdditions` object omits the key (matching `ipc.ts:1836-1837`).
- Overrides: payload beats profile for `effort` / `modelEffort` / `permissionMode`, and a null
  override falls through — `ipc.ts:1816`, `:1822`, `:1832` asserted once instead of never.
- Resolver with fake lookups: no profile → `{}` and **no** `onDegrade`; missing profile → `{}` **and**
  one `onDegrade`; a profile `resolveLaunchProfile` refuses (deleted provider; agent mismatch;
  management route) → `{}` and one `onDegrade`; a good profile → the composed options.
- ⚠ **The resolver's result carries no `secrets`, `credential` or `route`** — assert the key set over
  a profile that *does* name a `credentialProfileId`. The D33 guard as a test; never delete it.

Not unit testable, and say so rather than faking it: that `index.ts` binds before `restore()` runs,
that `spawn()` carries the options to argv, that a real agent starts in the mode it was given.

## Verification Commands

```
npx vitest run src/main/services/launchOptionsCore.test.ts src/main/services/launchProfiles.test.ts
npm run typecheck
npx vitest run --reporter=dot
```

✅ Measured baseline this session at `3e391a0`, working tree as-is: **90 test files / 3194 tests, all
passing, 18.20 s**. The suite must end at that or higher. (⚠ `--reporter=basic` no longer exists in
this vitest — it fails with `ERR_LOAD_URL` and still exits 0. Use `--reporter=dot`.)

Runtime half — CDP against a **seeded** dev instance (plain `npm run dev` has no credentials, so
profile-backed panes look broken for the wrong reason). Seed a throwaway user-data-dir from
`%APPDATA%\chorus-app` **including `Local State`** (the OSCrypt key), then:

```
$env:REMOTE_DEBUGGING_PORT = '9222'
$env:ELECTRON_CLI_ARGS = '["--user-data-dir=<seeded dir>"]'
npm run dev
```

✅ Verified, not recalled: `electron-vite/dist/chunks/lib-q6ns0vZr.js:225-226` turns
`REMOTE_DEBUGGING_PORT` into `--remote-debugging-port` on the Electron argv, and `:224` parses
`ELECTRON_CLI_ARGS` as a JSON array. ⚠ Kill the dev instance by `Name='electron.exe'` **and** a
`*remote-debugging-port=9222*` command line — a bare `*9222*` match kills Chrome renderers and the
querying shell.

## Acceptance Criteria

- `composeLaunchOptions` is the **only** thing in `src/main` that builds an options object from a
  resolved plan: `grep -n "Pick<LaunchOptions" src/main/ipc.ts` returns **nothing**.
- `grep -rn "vault\|decryptForLaunch" src/main/services/sessionManager.ts src/main/services/launchOptionsCore.ts`
  returns **nothing**, `grep -n "async" src/main/services/launchOptionsCore.ts` returns nothing, and
  `npm run typecheck` → 0 errors with the full suite ≥ **90 files / 3194 tests**, all passing.
- **Runtime, both halves required.** (1) Launch a pane on a profile with a non-default permission
  mode and a non-empty `envAdditions`; `session:restart` it; the new PTY's argv carries the same
  `--permission-mode` and its env the same additions. (2) Quit with that pane open and boot again —
  the **restored** pane carries both. Proving only (1) has not closed F115; (2) is the half the
  spec's `sessionManager.ts:600` citation is about.
- A credentialed pane still does **not** come back: `exited`, unchanged "Credential not re-supplied…"
  title. And `git diff --stat` shows no change to `roadmap.md` or `TerminalPane.vue` (lone CR bytes).

## Review Checklist
- [ ] The shared function is synchronous, and a comment says the synchronicity **is** the enforcement
      of D33 — `await vault.decryptForLaunch` cannot be written inside it.
- [ ] `SessionManager` still holds zero references to the vault, and `launchOptionsCore.ts` never
      gained one.
- [ ] Nothing in `restore()` changed except the argument at `:600`, and `session:restart` is still a
      synchronous handler with the same response shape.
- [ ] The fresh-launch path is unchanged for every override combination, with a test covering
      `req.x ?? profile.x` rather than trusting the diff.
- [ ] The degrade path reports once per failure and never throws — a bad profile row must not be able
      to end a restore loop.
- [ ] `mergeWiringEnv`'s precedence is byte-identical, the new reachability of its trap is written
      down where the next reader will find it, and no new stale line citation was added.

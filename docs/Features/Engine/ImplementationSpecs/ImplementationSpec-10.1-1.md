# Implementation Spec 10.1-1 — `launchOptionsCore.ts`

Companion to `Tasks/Task-10.1-1.md`. Exact placement, the seam as real TypeScript, and the rationale
that has to survive into the code as comments. Every line number was read out of the file at
`3e391a0` this session.

---

## The crux, stated before the code

The composition in `session:relaunch` is **async**; the restore loop's `spawn()` is **sync**. The
obvious reading is that the extracted function must be async and SessionManager must learn to await
it. **That reading is wrong, and getting it wrong costs the D33 invariant.**

It is async for exactly one reason: `resolveCredential` (`ipc.ts:1292`) awaits
`vault.decryptForLaunch` (`:1379`). Everything else — `resolveLaunchProfile` (`launchProfiles.ts:222`),
the four `Pick<LaunchOptions, …>` slices, the three storage row lookups (`storage.ts:3169`, `:2251`,
`:2301`, all synchronous better-sqlite3 reads) — is already synchronous. And the credential half is
**provably unreachable** from the two callers that need fixing: restore heals a credentialed session
instead of spawning it (`sessionManager.ts:571`, then `:575-584`) and restart refuses one inline
(`ipc.ts:2238`, message `:2242`). Both use `sessionIsCredentialed` (`launchProfiles.ts:127-138`),
**fail-safe true** on an unresolvable pointer.

So the shared function is the **credential-free** composition, and it is **synchronous**. That is not
a convenience. `ipc.ts:3175-3179` says the no-unattended-decrypt invariant "is ONE CARELESS `await`
WIDE: if any part of this logic is ever factored into a helper that restore() also calls, the
invariant is gone and NOTHING WILL FAIL TO COMPILE." **This task is that factoring.** A synchronous
return type makes the warning obsolete instead of realised: `vault.decryptForLaunch` returns a
`Promise`, so inside `(row) => LaunchOptions` it cannot be awaited and its result cannot be read —
the compiler now enforces what the comment could only ask for.

Three corroborating reasons, each independently sufficient: (1) `session:restart` is a **synchronous**
handler — `ipc.ts:2203` returns `RestartResponse`, not a promise — so an async seam forces it async
for a decryption it is documented to refuse; (2) `index.ts:1336-1341` depends on `restore()`'s first
pass being synchronous up to the first stagger await (*"it heals rows and can spawn the first session
before ever yielding"*), and an awaited resolver inserts a yield before the first spawn, changing boot
order relative to `createWindow` at `:1349`; (3) a sync function with injected lookups is unit-testable
with three fakes, while an async one bound to a vault is not testable at all here.

## Placement rationale — `src/main/services/launchOptionsCore.ts`, beside `launchProfiles.ts`

Not inside `launchProfiles.ts`: that module's header (`:9-26`) claims it never sees plaintext and its
resolution "carries that id and the credential's LABEL and nothing else". `LaunchOptions` carries
`secrets` and `credential` in its type (`sessionManager.ts:162-164`), and importing that type into a
module whose header is a no-plaintext promise weakens a promise that is currently structural.

Not inside `sessionManager.ts`: the class comment at `:261-263` says storage reaches it **only** for
the restore engine's heal and status writes, and that "launch/attach keep the 1-4 division of labor —
the IPC layer owns rows." Reading profile, provider and credential rows in the manager to decide a
launch would retire that division silently. A separate module with callback lookups keeps both
promises intact and matches the precedent already in the tree — `launchProfiles.ts:127`.

⚠ **The `LaunchOptions` import is type-only in both directions** — `import type { LaunchOptions }
from './sessionManager'` here, `import type { LaunchOptionsResolver } from './launchOptionsCore'`
there. Type-only imports erase, so there is no runtime cycle; `import { … }` without `type` in either
file creates one, and it presents as an undefined class at boot, not a compile error.

## Shapes

```ts
import type { EffortLevel, PermissionMode } from '../../shared/ipc'
import type { LaunchOptions } from './sessionManager'
import {
  resolveLaunchProfile,
  type CredentialRowLite, type ProfileRowLite, type ProviderRowLite, type ResolvedLaunchPlan
} from './launchProfiles'

/** The quarter of a resolved plan a session may get back with NO HUMAN PRESENT.
 *  ⚠ `credentialProfileId`, and therefore `secrets`/`credential`/`route`, is
 *  deliberately NOT in this Pick. D33: restore and session:restart refuse a
 *  credentialed session outright (sessionManager.ts:575, ipc.ts:2238). */
export type ProfilePlanOptions =
  Pick<ResolvedLaunchPlan, 'effort' | 'modelEffort' | 'permissionMode' | 'envAdditions'>

/** What the DIALOG chose. Payload beats profile — ipc.ts:1816/:1822/:1832, one rule not three. */
export interface LaunchOverrides {
  readonly effort?: EffortLevel | null
  readonly modelEffort?: string | null
  readonly permissionMode?: PermissionMode | null
}

export function composeLaunchOptions(plan: ProfilePlanOptions, overrides?: LaunchOverrides): LaunchOptions

/** Supplied by the caller so this module never imports storage. Precedent:
 *  sessionIsCredentialed's `lookup` (launchProfiles.ts:129). */
export interface ProfileLookups {
  readonly launchProfile: (id: string) => ProfileRowLite | null
  readonly provider: (id: string) => ProviderRowLite | null
  readonly credential: (id: string) => CredentialRowLite | null
}

/** ⚠ SYNCHRONOUS, AND THAT IS THE ENFORCEMENT — see the crux above. */
export type LaunchOptionsResolver = (row: {
  readonly id: string
  readonly agent: string
  readonly launchProfileId: string | null
}) => LaunchOptions

export function makeLaunchOptionsResolver(
  lookups: ProfileLookups,
  /** Reported, never thrown and never logged from here — no logger in this module. */
  onDegrade: (sessionId: string, reason: string) => void
): LaunchOptionsResolver
```

### Omitted keys, not `undefined` ones

`composeLaunchOptions` must build with the `Pick` + spread idiom the two existing sites already use
(`ipc.ts:1817`, `:1823`, `:1833`, `:1836`), so an absent value produces **no key**. ⚠ **The compiler
will not catch a regression here.** `exactOptionalPropertyTypes` is not set — this
repo's whole TS config is `@electron-toolkit/tsconfig/tsconfig.json` (`strict: true`,
`noImplicitAny: false`) plus `composite` and `types` in `tsconfig.node.json` — so
`{ effort: undefined }` typechecks. It is wrong because the composed object is **spread into other
objects** at two of the four call sites (`{ ...composed, conversationBoundary: 'restart' }`, and the
credential block at `ipc.ts:3263-3271`), and an explicit `undefined` clobbers on a spread while an
absent key does not. The unit test asserts `'effort' in opts === false`; nothing else will catch it.

## Exact insertion points

| File | Line | Now | After |
|---|---|---|---|
| `sessionManager.ts` | `:284` area | `private hookConfigDir` … | add `private launchOptions: LaunchOptionsResolver \| null = null` |
| `sessionManager.ts` | `:349` | `bindHooks(hooks, configDir)` | add `bindLaunchOptions(resolve)` immediately after, same doc shape |
| `sessionManager.ts` | `:600` | `this.spawn(row.agent as AgentKind, row.cwd, row.id)` | `…, this.launchOptions?.(row) ?? {})` |
| `sessionManager.ts` | `:485-489`, `:205-212` | "the restore path … passes NO options"; a `:474` citation | rewrite both; the first is false the moment `:600` changes, the second was already wrong |
| `index.ts` | after `:541` | `sessions.bindStorage(storage)` | `sessions.bindLaunchOptions(makeLaunchOptionsResolver({…}, …))` |
| `ipc.ts` | `:2258` | `sessions.launch(…, { conversationBoundary: 'restart' })` | `{ ...launchOptionsFor(row), conversationBoundary: 'restart' }` |
| `ipc.ts` | `:3237-3255` | 18 lines of slices | one `composeLaunchOptions(resolution.plan)` |
| `ipc.ts` | `:1816-1843` | 27 lines of slices + overrides, with the `:1830-1831` claim that "restore and `session:restart` never reach this function at all" | one `composeLaunchOptions(resolution.plan, {…})`; rewrite the claim — the *function* is still unreached, the *values* now reach them |

### Where the bind goes, and why `index.ts` rather than `registerIpc`

All five existing collaborators are bound in `index.ts` (`:541`, `:571`, `:597`, `:620`, `:657`) and
the sixth belongs with them: a reader auditing "what does `SessionManager` hold?" reads one band of
`index.ts`, not 4,000 lines of `ipc.ts`. The ordering constraint is real and already reasoned about
there — the bind must precede `sessions.restore(project.id)` at `:1348`. `registerIpc` at `:1222`
would satisfy that too, but only by accident, and `restore()` is also reachable from the lazy path at
`ipc.ts:4082`.

`ipc.ts` builds its own resolver from the same factory at `registerIpc` scope
(`const launchOptionsFor = makeLaunchOptionsResolver(…)`, near `resolveCredential` at `:1292`) for
the restart and relaunch handlers. **Two call sites of one exported function is not two homes.**

⚠ **`bindLaunchOptions` must stay optional at the call site (`this.launchOptions?.(row) ?? {}`).**
Unbound is a legal steady state for every other collaborator here (`:288-292`, `:300-302`, `:304-315`),
and an unbound resolver reproduces today's behaviour precisely: no options.

## The degrade path

```ts
// the function makeLaunchOptionsResolver returns
if (row.launchProfileId === null) return {}          // never had a profile: nothing to lose
const profile = lookups.launchProfile(row.launchProfileId)
if (!profile) { onDegrade(row.id, 'launch profile no longer exists'); return {} }
const resolution = resolveLaunchProfile(
  profile,
  profile.providerId ? lookups.provider(profile.providerId) : null,
  profile.credentialProfileId ? lookups.credential(profile.credentialProfileId) : null
)
if (!resolution.ok) { onDegrade(row.id, resolution.reason); return {} }
return composeLaunchOptions(resolution.plan)
```

⚠ **`{}` and not a refusal, and the asymmetry with relaunch is deliberate.** `session:relaunch`
returns `{ ok: false, reason: 'This session has no saved launch profile…' }` (`ipc.ts:3220-3226`)
because a human clicked something and there is a dialog to show the reason in. Restore has no UI and
no user: refusing there would mean the pane does not come back, a worse regression than the bug being
fixed. Degrading to today's behaviour plus one log line is the honest answer. ⚠ And
`resolution.reason` is safe to log — `launchProfiles.ts:219-220` states refusal messages are
label-only by construction (no URL, no env var name or value, no key fragment); do not widen it.

## Verification

Unit cases are in the task file. Beyond those, read:
- `grep -n "Pick<LaunchOptions" src/main/ipc.ts` → nothing. If it still matches, a copy survived.
- `grep -n "async\|await\|Promise" src/main/services/launchOptionsCore.ts` → nothing; and
  `grep -n "^import {" …/sessionManager.ts …/launchOptionsCore.ts` → neither value-imports the other.
- `git diff --stat src/main/services/sessionManager.ts` → a handful of lines; a large diff means the
  restore loop was restructured, which is out of scope.

**Runtime, on a seeded dev instance over CDP on 9222.** ✅ `REMOTE_DEBUGGING_PORT` becomes
`--remote-debugging-port` at `node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:225-226`, and
`:224` parses `ELECTRON_CLI_ARGS` as a JSON array, so `--user-data-dir` travels there. Seed that
directory from `%APPDATA%\chorus-app` **including `Local State`** — without the OSCrypt key every
pre-existing credential blob is undecryptable and profile-backed panes fail for the wrong reason. The
instrument is the child's own argv and env, not the UI, and both halves are required:

1. **Restart.** Launch a claude pane on a profile with `permissionMode: 'plan'` and one
   `envAdditions` entry; note the PTY's pid; fire `session:restart`; read the **new** pid's command
   line — it must carry `--permission-mode plan`, not `auto`. ⚠ Filter by `Name` + `CreationDate`,
   never by a `CommandLine` substring: a `Win32_Process` argv filter matches its own query process.
2. **Restore.** With that pane open, quit and start again; same assertion on the pane that comes
   back. The half `sessionManager.ts:600` is about, and the half no unit test reaches.

Control case, and it must be run: with the fix reverted, both assertions show `--permission-mode auto`
(claude's `defaultLevelId`, `claude.ts:540`). A verification that cannot show the bug is not one.

Negative case: a pane launched on a credential-bearing profile must still come back as an `exited`
row titled "Credential not re-supplied — relaunch from the dialog to re-enter it"
(`sessionManager.ts:577-580`), **not** as a running pane with options. If it comes back live, the
resolver reached a credential and the task has broken the thing it was written to protect.

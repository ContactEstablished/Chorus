# Implementation Spec 3-1 — Carry-Over Fixes + Secret-Safe Logging Spine

_Companion to `Tasks/Task-3-1.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**. Where a code block below is given as literal text, it is a starting point to adapt to the surrounding file's conventions — not a byte-for-byte mandate — **except** where marked **EXACT**._

**Anchored to commit `04a8a0d`, verified 2026-07-21.** All insertion points are named symbols, never line numbers (house rule).

---

## 1. Why this task exists before the vault

Task 3-2 introduces the first secret in Chorus's history. Redaction added *after* a secret exists is a retrofit: every log site written in between is a site nobody audited. Landing the logging spine first means the vault is written into a codebase where `logger.info({ profile }, 'credential stored')` is already safe by construction.

The two carry-over fixes ride along because both are pre-existing defects the phase inherited, neither belongs in the logging commit's narrative, and F23 in particular is a live session-loss path that should not wait five tasks. D32 amends G3 for this session: **two commits, chore first**.

---

## 2. Commit 1 — F21: a distinct branch-force acknowledgment

### 2.1 The defect, precisely

`src/main/ipc.ts`, in the `IpcChannel.WorktreeRemove` handler, currently ends with:

```ts
await worktrees.removeWorktree(w.id, {
  deleteBranch: req.deleteBranch,
  forceDirty: !clean,
  // D26(j): branch -D escalation only behind the same typed token.
  forceBranch: req.confirmation === w.path
})
```

`req.confirmation` is the **dirty-removal** token. Its gate — `dirtyRemovalAllowed({ path, clean }, req.confirmation)` — returns `true` unconditionally when `clean` is true, so on a **clean** worktree the token is never *required*, yet it is still *consulted* for `forceBranch`. A caller that sends the path anyway, together with `deleteBranch: true`, reaches `branchDelete(repoRoot, branch, true)` — `git branch -D` on a branch git already refused to `-d` because it holds unmerged commits.

The escalation logic in `worktrees.ts::removeWorktree` is correct: it runs plain `-d` first, catches, and escalates only when `opts.forceBranch` is set **and** the error is an unmerged refusal. The **authorization** is what is wrong. One token cannot honestly mean two different destructions.

### 2.2 Schema change — `src/shared/ipc.ts`

Insert into `worktreeRemoveRequestSchema`, after the existing `confirmation` field:

```ts
  /** F21: a SEPARATE acknowledgment from `confirmation`, required before main
   *  will ever pass `force: true` to branchDelete. D26(j) said "the same typed
   *  confirmation"; that overloaded one token to license two different
   *  destructions — uncommitted FILES (confirmation, naming the path) and
   *  unmerged COMMITS (this, naming the branch). They are now distinct, so
   *  neither can stand in for the other. */
  branchForceConfirmation: z.string().optional()
```

Add the predicate immediately below `dirtyRemovalAllowed`, matching its house style (pure, exported, unit-tested, with the handler named as the authority):

```ts
/** The F21 branch-force gate, factored pure for the unit test (the
 *  worktree:remove handler is the authority). `-D` destroys unmerged commits,
 *  so it is licensed ONLY by an acknowledgment naming the BRANCH — never by
 *  the dirty-removal path token, and never by its absence. */
export function branchForceAllowed(
  wt: { branch: string },
  ack: string | undefined
): boolean {
  if (wt.branch === '') return false
  return ack === wt.branch
}
```

**The `wt.branch === ''` guard is load-bearing, not defensive noise.** Adopted worktree rows (population 4) are born with an **empty** `branch` — the standing dev fixture `9ba9b0da…` is exactly such a row. Without the guard, `branchForceAllowed({branch: ''}, '')` would be `true`, and an empty-string acknowledgment would license a force-delete of a nameless branch. `removeWorktree` already skips branch deletion when `row.branch === ''`, so this is defense in depth on a row shape that genuinely exists in the real database.

### 2.3 Handler change — `src/main/ipc.ts`

Replace only the `forceBranch` expression:

```ts
        // D26(j) as amended by F21: -D escalation is licensed by its OWN
        // acknowledgment naming the branch. The dirty-removal token no longer
        // reaches this decision — a main-side gate, so the escalation is
        // unreachable regardless of what any renderer sends.
        forceBranch: branchForceAllowed(w, req.branchForceConfirmation)
```

Add `branchForceAllowed` to the existing `../shared/ipc` import list. **Do not touch `forceDirty`** — `--force` for a dirty worktree remains gated by `dirtyRemovalAllowed` exactly as D26(i) specifies.

### 2.4 What deliberately does not change

`WorktreePanel.vue` is **not** touched. Nothing now sends `branchForceConfirmation`, so `-D` has **zero callers** — the same dormant state `--force` sat in between Tasks 2-1 and 2-3, which the roadmap treated as the correct shape for a destructive capability awaiting its one legal caller. Behavior a user sees is unchanged: checking "Also delete branch" on an unmerged branch still surfaces `removeWorktree`'s existing refusal message, which already tells them to run `git branch -D` themselves. **Do not add an escalation affordance** — that is a product decision nobody has made.

---

## 3. Commit 1 — F23: `insertLaunchedLeaf` becomes total

### 3.1 The defect, precisely

`src/renderer/src/stores/layout.ts`:

```ts
    insertLaunchedLeaf(target: SplitTarget | null, newSessionId: string) {
      const root =
        target && this.tree
          ? splitPane(this.tree.root, target.targetSessionId, target.direction, newSessionId)
          : createLeaf(newSessionId)
      this.tree = { version: 1, root }
      ...
    }
```

The comment above it says "the single root leaf when launching from the empty state" — true when the empty state was its only null-target caller. Task 1b-3's palette "Launch agent…" command made that path reachable with a **populated** tree: `App.vue`'s `openLaunchDialog()` is invoked with no argument from the palette, so `splitTarget.value` is null while `this.tree` is a full tree. Every other leaf is discarded.

The consequence chain is worse than a visual glitch: the PTYs keep running in main, so those sessions become **leafless `running` rows**, and D16 Q2's invisible-process guard heals leafless `running` rows to `exited` **before any spawn** at the next boot. The agents are silently terminated at restart. On-disk work survives (it lives in files and worktrees); the session and its scrollback do not.

**A second defect hides in the same expression.** `splitPane` (see `src/shared/layout.ts`) returns the tree **unchanged** when `targetSessionId` is not found in it. So a *stale* target — a split requested against a pane that closed while the launch dialog was open — silently drops the newly launched leaf, producing the identical leafless-row outcome by a different route. Fix both; a fix for only the null case leaves the class open.

### 3.2 The replacement

```ts
    /** Drop a launched session's leaf into the tree. TOTAL by construction
     *  (F23): the ONLY case that may assign a fresh single-leaf tree is an
     *  empty layout. A populated tree always GROWS — it is never replaced,
     *  whatever the caller passes. An absent or stale anchor falls back to the
     *  first leaf in tree order rather than dropping the new pane, because
     *  splitPane returns the tree unchanged for an unknown target and a
     *  dropped leaf becomes a leafless 'running' row that D16's boot heal
     *  kills. Only main-returned session ids are ever inserted. */
    insertLaunchedLeaf(target: SplitTarget | null, newSessionId: string) {
      if (!this.tree) {
        this.tree = { version: 1, root: createLeaf(newSessionId) }
        this.dirty = true
        this.schedulePersist()
        return
      }
      const wanted = target?.targetSessionId ?? null
      const anchor =
        wanted !== null && findLeaf(this.tree.root, wanted) !== null
          ? wanted
          : collectSessionIds(this.tree.root)[0]
      const root = splitPane(this.tree.root, anchor, target?.direction ?? 'row', newSessionId)
      this.tree = { version: 1, root }
      this.dirty = true
      this.schedulePersist()
    },
```

Extend the existing `../../../shared/layout` import with `collectSessionIds` and `findLeaf`.

**Why `collectSessionIds(...)[0]` is safe:** a non-null tree has at least one leaf (a documented invariant of `src/shared/layout.ts`, enforced at every boundary and asserted by `normalizeTree`), so the index is never `undefined`. **Why `findLeaf` rather than trusting `splitPane`'s no-op:** the no-op is silent. Checking first makes the fallback deliberate and lets a reviewer see the stale-anchor case is handled rather than inferring it.

**Direction default `'row'`** matches the existing split-button convention and is the one the user perceives as "add a pane beside this one".

### 3.3 Caller change — `src/renderer/src/App.vue`

In `onLaunched`, replace the bare call:

```ts
  // F23: a palette launch carries no split target. Anchor it to the pane the
  // user is actually looking at (effectiveFocused already resolves stale focus
  // to the first leaf, F4); a null focus falls through to the store's own
  // first-leaf fallback. The store is total either way — this only chooses a
  // BETTER anchor, it is not what makes the operation safe.
  const anchor: SplitTarget | null =
    splitTarget.value ??
    (layout.tree && effectiveFocused.value
      ? { targetSessionId: effectiveFocused.value, direction: 'row' }
      : null)
  layout.insertLaunchedLeaf(anchor, snapshot.sessionId)
```

`effectiveFocused` and `splitTarget` are both already defined in this file. Match the local `SplitTarget` import/type usage already present. **Confine the edit to `onLaunched`** — the palette, the dialog, and the split buttons are otherwise untouched.

---

## 4. Commit 2 — the logging spine

### 4.1 Dependency

`pino` goes into **`dependencies`** (not `devDependencies`): it is required at runtime by the main process. electron-vite already externalizes `package.json` dependencies — the built `out/main/index.js` `require()`s `better-sqlite3`, `node-pty`, `zod`, and `@electron-toolkit/utils` rather than inlining them, so **no `electron.vite.config.ts` change is needed**. Confirm after install that the rebuilt bundle contains `require("pino")` and that a cold boot starts.

**No transport, no `pino-pretty`, no `pino-roll`** (D30). A transport spawns a worker thread; with none configured, pino writes synchronously to stdout, which is what electron-vite dev shows. Packaged GUI builds have no stdout — that is Phase 7's file-transport problem and is explicitly deferred.

### 4.2 `src/main/services/logger.ts` — create

Two exports carry the security weight and must be independently testable: **`scrubSecrets`** (pure) and **`REDACT_PATHS`** (data).

```ts
import pino from 'pino'

/**
 * Main-process logger with a redacting serializer (D30 / PLAN §6).
 *
 * TWO mechanisms, because one is not enough:
 *  1. `redact` covers STRUCTURED fields by path — it can only match keys it
 *     was told about, and only in objects.
 *  2. `scrubSecrets` covers FREE TEXT — an interpolated message, an Error
 *     message, a stack frame. pino's redact never sees these, and an
 *     interpolated key is the likeliest real-world leak.
 *
 * Scope note: this scrubs LOG RECORDS ONLY. It does not touch PTY output, the
 * session ring buffer, or session:data — whether that stream is scrubbed is
 * CR-3.0's open question and is deliberately not decided here.
 */

/** Field names whose values are never printed, wherever they appear. Wildcard
 *  prefixes cover nesting; add to this list as the vault lands. */
export const REDACT_PATHS: string[] = [
  'apiKey', '*.apiKey',
  'key', '*.key',
  'token', '*.token',
  'secret', '*.secret',
  'password', '*.password',
  'encryptedBlob', '*.encryptedBlob',
  'env.ANTHROPIC_API_KEY',
  'env.OPENAI_API_KEY',
  'env.GEMINI_API_KEY',
  'env.OPENROUTER_API_KEY'
]

const PLACEHOLDER = '[redacted]'

/** Known credential shapes, anchored tightly enough that ordinary log text —
 *  Windows paths, UUIDs, git SHAs, chorus/<repo>/<8hex> branch names —
 *  survives unchanged. An over-broad scrub that mangles our own logs is a
 *  defect, not caution. Verify each prefix against the provider's own docs at
 *  execution (D4) rather than from memory. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,        // Anthropic
  /sk-or-v1-[A-Za-z0-9_-]{20,}/g,      // OpenRouter
  /sk-proj-[A-Za-z0-9_-]{20,}/g,       // OpenAI project keys
  /sk-[A-Za-z0-9]{32,}/g,              // OpenAI classic (after the more specific ones)
  /gh[pousr]_[A-Za-z0-9]{36,}/g,       // GitHub
  /AKIA[0-9A-Z]{16}/g                  // AWS access key id
]

/** Replace every known key shape in a free-text string. Pure and total. */
export function scrubSecrets(text: string): string {
  let out = text
  for (const re of SECRET_PATTERNS) out = out.replace(re, PLACEHOLDER)
  return out
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: REDACT_PATHS, censor: PLACEHOLDER },
  formatters: {
    // Keep the level as a readable string rather than pino's numeric default;
    // these logs are read by humans in a dev console far more often than by
    // machines.
    level: (label) => ({ level: label })
  },
  hooks: {
    // The free-text half. pino's redact never inspects the message, so every
    // call routes its message through the scrub before it is emitted.
    logMethod(args, method) {
      const scrubbed = args.map((a) => (typeof a === 'string' ? scrubSecrets(a) : a))
      return method.apply(this, scrubbed as Parameters<typeof method>)
    }
  }
})
```

**Ordering inside `SECRET_PATTERNS` matters:** the generic `sk-[A-Za-z0-9]{32,}` must come **after** the `sk-ant-` / `sk-or-v1-` / `sk-proj-` patterns, or those would partially match first and leave a recognizable prefix behind. Keep the comment that says so.

**Verify the `hooks.logMethod` signature against the installed pino's own typings at execution (D4).** The hook is the mechanism that makes message scrubbing real; if pino's current API differs, implement the same guarantee another way (e.g. thin exported wrapper functions that scrub before delegating) rather than dropping it — **a redact-paths-only implementation satisfies a naive test and fails the actual leak case.**

### 4.3 Call-site migration — the exact 24

Migrate mechanically: **same event, same information, same bracketed prefix**. Do not add, remove, or re-level a log site. The prefix (`[storage]`, `[restore]`, `[worktrees]`, `[notify]`, `[title]`, `[cli-detect]`) may stay in the message text or become a child logger (`logger.child({ mod: 'restore' })`) — pick one convention and apply it uniformly.

| File | Sites | Notes |
|---|---|---|
| `src/main/index.ts` | 4 — the dev-toast-shortcut line in `ensureDevToastShortcut`, the project line in `whenReady`, the reconcile-failure `console.error`, and the `[cli-detect]` loop inside the `detectClis().then(...)` block | Import and use the logger from the top of the boot sequence so nothing before it logs raw. |
| `src/main/ipc.ts` | 3 — two `[worktrees] list:` lines in the `WorktreeList` handler, and the `[title] persisted` line in `SessionSetTitle` | The `[title]` line already `JSON.stringify`s the title; keep it — titles are terminal output and could contain anything. |
| `src/main/services/notifications.ts` | 2 — the toast `show` and `failed` handlers | Also reword the comment above them that says the lifecycle is "diagnosable from the console". |
| `src/main/services/sessionManager.ts` | 5 — four `[restore]` lines plus the `console.error` spawn-failure | The spawn-failure site passes an `err` object as a second argument; use pino's `logger.error({ err }, msg)` form so the serializer handles it. |
| `src/main/services/storage.ts` | 2 — the legacy-layout conversion line and the invalid-layout warning | Keep the warn level on the second. |
| `src/main/services/worktrees.ts` | 8 — the evidence-read warning, the reconcile summary, and six per-action lines in the reconcile loop | The reconcile summary is the line the coordinator's runtime checks grep for (`N row(s) across M repo(s); K surfaced`) — **preserve that exact wording**, it is load-bearing for the phase's regression evidence. |

After migration, `grep -rn "console\." src/main --include=*.ts` must return nothing outside comments.

### 4.4 `scripts/secret-grep.mjs` — create

The G4 gate as an executable command. Plain Node ESM (no dependency); add `"grep:secrets": "node scripts/secret-grep.mjs"` to `package.json` scripts.

Requirements:
- Scan **tracked source** (`src/`, `scripts/`, `package.json`, config files), plus `_verify/` and any `*.log`/`*.json` artifact under it — `_verify/` is gitignored but is precisely where a careless runtime dump would land a key.
- Reuse the **same patterns** as `logger.ts` by importing `SECRET_PATTERNS` if practical, or keep one copy and have the other import it. **Do not maintain two divergent pattern lists** — a gate that tests different shapes than the scrubber is worse than no gate.
- Print each hit as `path:line` with the match **masked**, never echoed in full.
- Exit **non-zero** on any hit, zero when clean, so it can gate a commit.
- Ignore `node_modules/`, `out/`, `.git/`.

### 4.5 Tests — `src/main/services/logger.test.ts`

Vitest, colocated with the other main-process service tests (`restore.test.ts`, `worktrees.test.ts` set that precedent).

Cover, at minimum:
1. Each pattern in `SECRET_PATTERNS` is scrubbed to the placeholder.
2. **Multiple occurrences in one string** are all replaced (the `g` flag is easy to forget, and `String.replace` without it silently replaces only the first).
3. **Ordering:** a string containing `sk-ant-…` emits the placeholder with **no residual `sk-ant-` prefix** — this is the regression test for pattern ordering.
4. **Non-secrets survive byte-identical**: `C:\Projects\ContactEstablished\Chorus`, a UUID (`985d547b-d152-4a07-9094-ddb8da56ef8f`), a 40-char git SHA, and `chorus/Chorus/24b5c1fe`.
5. `REDACT_PATHS` includes the field names the vault will use, so a reviewer can read the coverage in one place.

Use **synthetic keys of realistic shape** — never a real credential, and never a string that could be mistaken for one outside the test file.

---

## 5. Verification

### 5.1 Static

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
git grep -n "console\." -- src/main
```

The last must return nothing outside comments.

```
git grep -n "forceBranch\|force: true" -- src/main
```

Expect exactly one authorization site (`branchForceAllowed(...)` in the handler) and one emission site (`branchDelete(..., true)` in `removeWorktree`), mirroring the `--force` discipline Task 2-1 established.

### 5.2 Runtime — F21 (build a throwaway; never touch the standing fixture)

**The standing fixture is off limits.** The real dev DB holds one `worktrees` row (`9ba9b0da…`, branch `chorus/Chorus/24b5c1fe`, path `…\.chorus\Chorus\wt-24b5c1fe`), retained deliberately as the population-4 / empty-`base_branch` regression fixture. Do not remove it, its directory, or its branch.

Build a disposable one instead, give its branch an **unmerged commit** (so `-d` genuinely refuses and the difference between `-d` and `-D` is observable), let the app adopt it via boot reconcile, then drive `window.chorus.removeWorktree({...})` over CDP with the **crafted pre-fix payload**: `{ worktreeId, deleteBranch: true, confirmation: <the worktree path> }` and **no** `branchForceConfirmation`, against the **clean** worktree.

- **Pre-fix behavior** (the defect): the branch is force-deleted; its commit becomes unreachable.
- **Required post-fix behavior**: the worktree is removed, `removeWorktree` throws the surfaced unmerged-refusal message, **the branch still exists**, and its commit is still reachable.

Prove the last two with:

```
git -C "C:/Projects/ContactEstablished/Chorus" branch --list "chorus/*"
```

```
git -C "C:/Projects/ContactEstablished/Chorus" worktree list
```

Then delete the throwaway branch by hand. Report the exact payload sent and the exact branch list before and after.

### 5.3 Runtime — F23

With a **populated** layout (at least two panes), open the palette with `Ctrl+K`, run **"Launch agent…"**, and complete a launch. Required: the layout now holds **three** leaves; every pre-existing session id is still present; the new pane is visible and attached. Capture the persisted tree from the DB before and after (`pane_layouts.layout_json`) and show that the leaf set **grew** rather than being replaced.

Then the second half, which is the part that actually killed sessions: **cold-boot** the app (tree-kill first — electron-vite does not hot-restart main) and confirm none of the pre-existing sessions were healed to `exited` as leafless `running` rows. A boot log free of `[restore] healed running row with no layout leaf` for those ids is the evidence.

Also exercise the empty state once (close every pane, launch from the empty state) to confirm the single-root-leaf path still works.

### 5.4 Runtime — redaction

Cold-boot and confirm the migrated lines still appear with the same information in pino's structured form — specifically the `[worktrees] reconcile:` summary line with its exact `N row(s) across M repo(s); K surfaced` wording.

Then prove **both** halves of the mechanism with a planted fake key of realistic shape (e.g. `sk-ant-api03-` + 40 filler chars — synthetic, never real):

1. **Structured:** log an object with the key under a redacted path → emitted as `[redacted]`.
2. **Interpolated:** log the key inside a template-literal message → emitted as `[redacted]`.

The second is the one that fails when only `redact` paths are configured, so **both must be shown**. Then point `npm run grep:secrets` at a file containing the planted key and show it **exits non-zero**, and re-run it clean afterwards. Remove every planted key before committing and re-run the gate to prove the repo is clean.

### 5.5 Database evidence (F20 provenance rule)

Your `AppData` is redirected: your filesystem and git evidence is trustworthy, your **database** evidence describes a different DB than the coordinator's and will be re-verified against the real `%APPDATA%\chorus\chorus.db`. **Quote the `projects` table in every dump** so provenance is visible. `sqlite3` is not installed — use the `ELECTRON_RUN_AS_NODE` pattern from `_verify/2-1-dump.js`, write results to a file, and **retry once** if the first invocation produces none.

---

## 6. Invariants a reviewer must be able to check

1. **`branchDelete(..., true)` is reachable only through `branchForceAllowed`.** Not "also guarded by" — the old `req.confirmation === w.path` expression is **gone**.
2. **`branchForceAllowed` rejects the path token explicitly**, and there is a unit test named as the F21 regression that asserts it.
3. **`insertLaunchedLeaf` cannot discard a populated tree on any input.** The single-leaf assignment appears exactly once, inside the `!this.tree` branch.
4. **A stale anchor never drops the launched leaf** — checked with `findLeaf` before the split, with a test.
5. **Message scrubbing is real**, not redact-paths-only — demonstrated by the interpolated-key runtime proof, not merely by the unit test.
6. **The scrub does not mangle ordinary logs** — path, UUID, SHA, and `chorus/*` branch name survive byte-identical.
7. **One pattern list**, shared between the logger and the grep script.
8. **Nothing in this task touches PTY output, the ring buffer, or `session:data`** — CR-3.0 owns that ruling, and pre-empting it here would prejudge a council question.
9. **Two commits**, chore then task, each confined to its own scope table.
10. **The standing worktree fixture, its directory, and its branch survive untouched.**

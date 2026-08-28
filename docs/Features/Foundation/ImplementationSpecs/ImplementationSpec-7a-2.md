# Implementation Spec 7a-2 — `shell` as an agent kind

_Pairs with [`../Tasks/Task-7a-2.md`](../Tasks/Task-7a-2.md). Authored 2026-08-26 against `3c70e87`._

**Read the task doc first**, and read [`../AdapterAuthoring.md`](../AdapterAuthoring.md) before opening
`grok.ts` — it is 130 lines and it is the contract this file assumes. This document adds what a task
doc should not carry: the exact insertion points, the proposed code shapes, the refusal's wording, the
test cases, and the runtime checks that decide whether it worked.

Every `file:line` cited below was opened and checked on 2026-08-26 at `3c70e87`. **TypeScript blocks
are SKETCHES** — they are the shape and the reasoning, not text to paste unread. **⚠ And every line
number in a `.vue` file is a kickoff-day pointer**: 7a-1 lands first and deletes three `codes` maps out
of `LaunchDialog.vue`, `FilmstripRenderer.vue` and `TerminalPane.vue`, so re-take them at pickup.

---

## §0 — Probe before you build (do not skip)

Six things this spec rests on. **Measure all six.** `CLAUDE.md` forbids trusting recall for CLI syntax,
and four of these are facts about *this machine* rather than about the codebase.

### (1) The gates, with the junction in place

```powershell
New-Item -ItemType Junction -Path .\node_modules -Target C:\Projects\ContactEstablished\Chorus\node_modules
npm run typecheck ; npx vitest run ; npm run grep:secrets
```

Expect `0` · **`2941 / 78` with `codeIndexCore.test.ts` failing to COLLECT** (F103 — `_verify/` is
gitignored at `.gitignore:165` and holds zero tracked files) · clean, 6 patterns. **Record what you
actually get**; every later "≥ 2941" claim is measured against **your** number, not this one.

**⚠ If the vitest number is 2969 / 79 you are in the main checkout, not a worktree** — which is a
different tree with a different `git status`. Stop and find out which one you are editing.

### (2) The counters this task must not move

```powershell
# expect 22 — AST, NEVER a grep: the comments BETWEEN array elements contain
# backticks (storage.ts:196), so a character scanner returns garbage.
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"

# expect 110
node -e "const ts=require('typescript'),fs=require('fs');const p='src/shared/ipc.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='IpcChannel')i=n.initializer;ts.forEachChild(n,w)};w(sf);while(i&&(ts.isAsExpression(i)||ts.isSatisfiesExpression(i)))i=i.expression;console.log('IpcChannel keys =',i.properties.filter(p=>ts.isPropertyAssignment(p)).length)"

# expect 9
node -e "console.log('deps =',Object.keys(require('./package.json').dependencies).length)"
```

**Run all three again at the end.** A task whose whole design claim is "this needs no migration and no
channel" must prove it, not assert it.

### (3) The two shell candidates — the fact `buildLaunch` rests on

```powershell
where.exe pwsh
where.exe powershell
```

**What to do with each answer:**

- **Both resolve to real `.exe` files** (expected: `C:\Program Files\PowerShell\7\pwsh.exe` and
  `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`). Record the exact paths. A real `.exe`
  means `pickSpawnable` (`cliDetect.ts:36`–`:51`) takes its **first** branch and returns
  `{file: exe, args: [], path: exe}` — **so `cli.args` is empty in fact, which is why §1's
  `args: [...cli.args]` reads as `[]` on this machine.** Confirm it rather than assume it.
- **`pwsh` does not resolve.** Not a failure — it is the fallback path, and it should be *exercised*
  rather than merely written. Record it and note that the drive will observe `powershell`.
- **⚠ Neither resolves.** Stop and report. `powershell.exe` is in `System32` on every supported
  Windows, so this means something about the environment is wrong (a stripped PATH, a policy) and the
  adapter cannot be honestly specified against it.

**And time it**, because `resolveCli` is synchronous `execFileSync` and `detectInstallation` will pay
for it on every dialog open:

```powershell
Measure-Command { where.exe pwsh } | Select-Object -ExpandProperty TotalMilliseconds
```

**Paste the number.** If it is materially above a few milliseconds, say so in the report — the design
below takes the synchronous call deliberately (§1), and the decision deserves the measurement it was
taken against.

### (4) `powershell.exe --version` — the probe this design REFUSES, measured once so the refusal is evidenced

```powershell
Measure-Command { powershell.exe --version 2>&1 | Out-Null } | Select-Object -ExpandProperty TotalMilliseconds
Measure-Command { pwsh --version } | Select-Object -ExpandProperty TotalMilliseconds
```

`probeCli` (`cliDetect.ts:167`) spawns `<tool> --version` with a **10-second timeout** and falls back
to the string `'unknown'` when it fails. Windows PowerShell 5.1 does not take `--version`. **Record
both numbers.** They are the cost this adapter declines to pay on every dialog open, and §1's comment
quotes them.

### (5) The `launch_profiles` census — the measurement that settles the kimi question

Task fact 4: **`kimi.ts:94` also declares `apiKey: false`**, so D185's predicate reaches it. Whether
that matters is a question about rows, not about argument. `launch_profiles.agent` is `TEXT`
(`schema.ts:560`) and `credential_profile_id` is the credentialed predicate (`:566`).

Read **both** databases from a **copy** (they are WAL-mode; copy `-wal` and `-shm` too), under
Electron-as-node because the repo's `better-sqlite3` is built for the **Electron** ABI:

```js
// _verify/7a-2/profiles-census.js
const fs = require('fs'), path = require('path')
const dbs = [
  path.join(process.env.APPDATA, 'chorus', 'chorus.db'),          // dev
  path.join(process.env.APPDATA, 'chorus-app', 'chorus.db')       // installed — the real instance
]
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))
for (const src of dbs) {
  if (!fs.existsSync(src)) { console.log(src, '— absent'); continue }
  const dst = path.join(__dirname, path.basename(path.dirname(src)) + '-copy.db')
  for (const s of ['', '-wal', '-shm']) if (fs.existsSync(src + s)) fs.copyFileSync(src + s, dst + s)
  const db = new Database(dst, { readonly: true })
  console.log(src)
  console.log(db.prepare(
    `SELECT agent, COUNT(*) AS profiles,
            SUM(credential_profile_id IS NOT NULL) AS with_credential
       FROM launch_profiles GROUP BY agent ORDER BY agent`).all())
}
```

```powershell
$env:ELECTRON_RUN_AS_NODE=1
node_modules\electron\dist\electron.exe _verify\7a-2\profiles-census.js
```

**The rule this measurement decides, stated in advance so the answer cannot be reverse-engineered from
what is convenient:**

- **`kimi` profiles = 0 on both databases** → take **D185's literal form**: `apiKey === false` refuses
  **both** `credential_profile_id` and `launch_profile_id`. Write the census number into the guard's
  comment so the next reader knows the sweep was measured, not overlooked.
- **`kimi` profiles > 0** → the guard's **profile** half must not refuse a profile that carries no
  credential. Refuse on `req.credential_profile_id` unconditionally, and on `req.launch_profile_id`
  **only when the profile's `credential_profile_id` is non-null** — the column the schema already
  calls *"THE CREDENTIALED PREDICATE"*. **Report the divergence from D185's wording and the row count
  that forced it**; do not take it silently.

**⚠ Either way the predicate stays `apiKey === false`.** Narrowing it to `req.agent === 'shell'` makes
the guard pass every test in this task and protect nothing else, which is the exact generalisation
D185 asked for by name.

### (6) Which world 7a-1 left you in

```powershell
Test-Path src/renderer/src/components/AgentMark.vue
Get-ChildItem -Path src/renderer/src -Recurse -Include *.vue | Select-String -Pattern "const codes: Record<AgentKind"
```

- **`AgentMark.vue` exists and the grep is empty** → the expected world. This task touches **no `.vue`
  glyph code**; §8 and §9 are label-map edits only.
- **`AgentMark.vue` is absent and the grep returns three hits** (`LaunchDialog.vue:608`,
  `FilmstripRenderer.vue:100`, `TerminalPane.vue:80` at `3c70e87`) → 7a-1 has not landed. Each map is
  `Record<AgentKind, string>` and the typecheck will flag all three. **Add `shell: '>_'` to each and
  stop there.** Do not build `AgentMark.vue`; that is 7a-1's file and a second implementation is a
  second home for one fact.

**Say which world you were in, in the report.**

---

## §1 — `src/main/adapters/shell.ts` (new)

**Placement rationale:** one file per adapter is the registry's shape and always has been; the
alternative — a `shell` branch inside an existing adapter, or a synthetic adapter minted in
`registry.ts` — would put an agent's declaration somewhere `AdapterAuthoring.md` does not send a
reader looking for it.

**Model it on `grok.ts`.** It is the newest adapter (322 lines, D165, 2026-08-18), written to the
current contract, and its member order — `id` `:48`, `displayName` `:49`, `executionMode` `:50`,
`requiredEnvVars` `:61`, `detectInstallation` `:63`, `getAuthMethods` `:71`, `getCapabilities` `:102`,
`buildLaunch` `:141` — is the layout to copy. **Copy the layout, not the bodies:** every single body
differs here, and fact 2 in the task doc is what happens when one is copied verbatim.

### The imports — and the one that is deliberately absent

```ts
import { resolveCli, type ResolvedCli } from '../services/cliDetect'
import type {
  AgentCapabilities,
  AuthMethodDefinition,
  InstallationStatus,
  PtyAgentAdapter,
  PtyLaunchRequest,
  PtyLaunchSpec
} from './types'
```

**⚠ `buildSecretEnv` IS NOT IMPORTED, AND ITS ABSENCE IS PART OF THE DESIGN.** Every other PTY adapter
imports it from `./capabilities` — including `kimi.ts`, which declares `apiKey: false` and routes
through it anyway *"so that if D87 ever gives kimi a key path it inherits the same handling the other
two get instead of growing a private one"* (`kimi.ts:158`–`:162`). That is a good reason to keep a
door open for an adapter whose key path might one day exist. **Here the door is the defect.** A shell
must never receive a credential under any future change, so the honest expression is a literal `{}` —
and a reviewer grepping `shell.ts` for `credential` should find nothing at all. `probeCli` is not
imported either, for §1's `detectInstallation` reason.

### The resolver — ONE, shared by detection and launch

```ts
/**
 * The shell Chorus opens, in preference order.
 *
 * ⚠ `pwsh` FIRST BECAUSE IT IS THE ONE THE USER CHOSE. PowerShell 7 is an
 * opt-in install; a machine that has it has it deliberately, and it is the
 * shell that machine's owner uses. `powershell` is the floor, present on every
 * supported Windows, so this list cannot come back empty on a working machine —
 * and if it does, that is a fact about the environment worth failing loudly on
 * rather than papering over with cmd.exe.
 *
 * ⚠ NO `cmd`, NO `bash`, NO WSL, AND NO USER SETTING. One kind, one policy.
 * A shell picker is a settings surface and this phase builds none; adding one
 * here would put a preference into an adapter, which is where MEASURED FACTS
 * about a CLI live (D34 Q1).
 */
const SHELL_CANDIDATES: readonly string[] = ['pwsh', 'powershell']

/**
 * ⚠ ONE RESOLVER, USED BY BOTH `detectInstallation` AND `buildLaunch`, SO
 * DETECTION AND LAUNCH CAN NEVER DISAGREE ABOUT WHICH BINARY THE USER GETS.
 * That is `probeCli`'s own rule one level in (`cliDetect.ts:157`-`:163`: "ONE
 * implementation, because … two copies of this logic are how it drifts"). A
 * card that says "found" while the launch throws, or the reverse, is the
 * failure this shape exists to make impossible.
 *
 * ⚠ SYNCHRONOUS, AND THAT IS A COST TAKEN DELIBERATELY. `resolveCli` is
 * `execFileSync('where.exe', …)`, so `detectInstallation` — which is async and
 * whose four siblings are genuinely async — blocks main's loop for one or two
 * `where.exe` calls per dialog open (§0(3) measured <N> ms). The alternative is
 * an ASYNC copy of where.exe resolution living in this file, which is a second
 * resolver that can drift from the one `buildLaunch` uses. Drift is the more
 * expensive failure and it is silent; a few milliseconds is neither.
 *
 * `null` rather than a throw, so `detectInstallation` can report "not found"
 * the way every other probe does. `buildLaunch` turns it back into a throw,
 * because a launch with no executable has nothing else to be.
 */
function resolveShell(): ResolvedCli | null {
  for (const name of SHELL_CANDIDATES) {
    try {
      return resolveCli(name)
    } catch {
      // `resolveCli` throws for "not on PATH" and for "on PATH but nothing
      // spawnable". Both mean the same thing here: try the next candidate.
    }
  }
  return null
}
```

### The adapter

```ts
/**
 * The `shell` PTY adapter — a real PowerShell in a pane, labelled `Terminal`.
 * The SIXTH registry entry (D185), added 2026-08-26 so that Phase 7a's
 * Workbench preset ("an agent plus a shell in the same tree", D189(b)) has
 * something to launch.
 *
 * ⚠ THE ONE STRUCTURAL DIFFERENCE FROM EVERY ADAPTER BEFORE IT: `id` IS A
 * REGISTRY KEY, NOT A BINARY NAME. `probeCli(this.id)` and
 * `resolveCli(this.id)` are correct in claude.ts, codex.ts, grok.ts, kimi.ts
 * and opencode.ts and are WRONG here — there is no `shell.exe`, so both would
 * report "not found" and "cannot spawn" respectively, for ever, with no error
 * anywhere. Everything else in this file follows from that one divergence.
 *
 * ⚠ WHY AN ADAPTER AND NOT A `session.kind` DISCRIMINATOR (D185). A
 * discriminator would say structurally that a shell is not an agent, which is
 * true and expensive: it touches the DB schema, the wire and every session
 * surface, to buy a distinction THE SIX NULL CAPABILITIES BELOW ALREADY
 * ENFORCE AT EVERY CALL SITE. `supportsMcp`, `supportsHooks`, `supportsResume`
 * and `supportsInstructions` each narrow to `false` here by the existing
 * BOTH-HALVES rule (types.ts:992-:1054), so no MCP file is written, no hook
 * config is minted, no resume pointer is assigned and no instructions file is
 * created — without one `if (kind === 'shell')` anywhere in the app.
 *
 * ⚠ AND THE ONE THING THIS ROUTE DOES NOT BUY: A REFUSAL. An adapter can
 * decline to ASK for a credential; it cannot stop main from RESOLVING one that
 * arrived on the launch payload. That guard lives in `main/ipc.ts` beside its
 * sibling refusal — see §5.
 */
export const shellAdapter: PtyAgentAdapter = {
  id: 'shell',
  displayName: 'Terminal',
  executionMode: 'pty',

  /** Nothing beyond the Windows baseline. A shell inherits `process.env`
   *  wholesale on the no-credential branch of `composeChildEnv` (env.ts:143),
   *  exactly as every subscription-auth launch does today, so there is nothing
   *  to preserve that is not already preserved. */
  requiredEnvVars: [],

  async detectInstallation(): Promise<InstallationStatus> {
    // ⚠ NOT `probeCli(this.id)`. See the header: `this.id` is 'shell' and
    // there is no shell.exe.
    const cli = resolveShell()
    if (!cli) return { found: false, path: null, version: null }
    // ⚠ `version: null` IS A DECISION, NOT AN OMISSION (D185). `probeCli`
    // would spawn `<shell> --version` with a 10 s timeout on EVERY dialog
    // open; Windows PowerShell 5.1 does not take `--version`, so that call
    // fails and yields the string 'unknown' after paying for a process
    // (§0(4) measured <N> ms). A `$PSVersionTable` probe costs the same and
    // buys the version of the user's WINDOWS INSTALL, which identifies the
    // machine rather than the agent and which nothing in Chorus acts on.
    // The card renders a blank line for a null version
    // (LaunchDialog.vue:886), which is the honest form of "no version
    // claimed" — D76: omit rather than stub.
    return { found: true, path: cli.path, version: null }
  },

  /**
   * ⚠ EMPTY, AND THE EMPTINESS IS THE DECLARATION — kimi.ts:56-:58 makes the
   * same move for the narrower case ("the ABSENCE of `api_key` is the
   * declaration"). There is nothing to log into and nothing to bill. The
   * launch dialog reads this and offers no auth control at all (§7).
   *
   * ⚠ AND THIS IS NOT THE SECURITY BOUNDARY. An empty list means the dialog
   * never OFFERS a credential; it does not mean main REFUSES one. Those are
   * different statements and the second one is §5.
   */
  getAuthMethods(): readonly AuthMethodDefinition[] {
    return []
  },

  getCapabilities(): AgentCapabilities {
    // ⚠ EVERY NULL BELOW MEANS "THIS DOES NOT EXIST FOR A SHELL" — WHICH IS A
    // STRONGER CLAIM THAN THE "UNMEASURED" NULLS IN grok.ts:126/:132/:137 AND
    // LOOKS IDENTICAL IN THE TYPE. grok's nulls are an invitation to measure;
    // these are a closed question. A reader who cannot tell them apart will
    // one day "finish" this adapter, so each one says which it is.
    return {
      // A PowerShell prompt is the most interactive terminal there is.
      interactiveTerminal: true,
      // It takes a cwd like any process; a worktree is just a directory.
      worktreeSafe: true,
      // Skills are an agent concept. There is no agent here.
      skills: false,
      // Nothing to log into.
      subscriptionLogin: false,
      // ⚠ FALSE, AND THIS BOOLEAN IS LOAD-BEARING BEYOND THIS FILE: §5's
      // refusal is keyed on it, so that the guard generalises to any future
      // adapter that cannot take a key rather than to the string 'shell'.
      // ⚠ NOTE kimi.ts:94 ALSO DECLARES FALSE, for a different reason — it
      // has no flag and no env var to receive a key. §5 and §0(5) address the
      // overlap deliberately rather than discovering it later.
      apiKey: false,

      // ── The six descriptors, all null, all INAPPLICABLE ────────────────
      // No model to choose, so no Model select renders.
      reasoningEffort: null,
      // No permission ladder: the shell has exactly the user's own authority,
      // which is the same authority Chorus itself runs with. Nothing to
      // broker, so no Permission segment renders.
      permissionMode: null,
      // No conversation to resume. A shell's history is the user's own
      // PowerShell history file; Chorus neither owns it nor reopens it, and a
      // `session:restart` gives a fresh prompt exactly as it gives every
      // agent a fresh conversation (D142).
      sessionResume: null,
      // No agent to give tools to. `withMcpEnv` writes nothing because
      // `supportsMcp` narrows to false here.
      mcp: null,
      // No lifecycle events, because there is no agent lifecycle. The pane
      // keeps exactly THREE states (D129) — a false amber is worse than no
      // amber. See §5's note on what this costs at spawn time.
      hooks: null,
      // No system prompt and no instructions file: there is nothing to
      // instruct.
      instructions: null
    }
  },

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    const cli = resolveShell()
    if (!cli) {
      // The same shape `resolveCli` throws for every other adapter, so the
      // failure surfaces the way a missing CLI already does: a rejected
      // invoke, rendered inline by the dialog (LaunchDialog.vue:770-:772).
      throw new Error(
        `Could not find a shell on PATH (tried ${SHELL_CANDIDATES.join(', ')}). ` +
          'Install PowerShell 7 or repair the Windows PATH.'
      )
    }
    return {
      executable: cli.file,
      // ⚠ CHORUS AUTHORS ZERO ARGUMENTS, AND `cli.args` IS NOT ONE OF ITS
      // OWN. On this machine both candidates are real .exe files, so
      // `pickSpawnable` returns `args: []` and this spreads to nothing
      // (§0(3) confirms it). It is spread anyway rather than written as a
      // bare `[]`, because `args` is the RESOLVER'S spawn form — `['/c',
      // <shim>]` on the cmd.exe fallback route — and dropping it would
      // silently break the branch F96 put there. D185 says "args: []"; that
      // is a statement about what CHORUS adds, and this honours it exactly.
      //
      // ⚠ AND NO `-NoProfile`. The user's PowerShell profile is the shell
      // they expect; suppressing it is a judgement about their machine that
      // this task is not entitled to make.
      args: [...cli.args],
      cwd: spec.cwd,
      envAdditions: {},
      // ⚠ A LITERAL, NOT `buildSecretEnv(spec.credential)`, AND THIS IS THE
      // SECOND HALF OF §5's DEFENCE. §5 stops a credential ARRIVING; this
      // stops one being USED if that guard is ever moved, narrowed or
      // reordered. A decrypted API key injected into a raw shell is readable
      // by the human at the prompt — `echo $env:ANTHROPIC_API_KEY`. Every
      // other adapter hands its key to a CLI that spends it; this one would
      // hand it to a person.
      secretEnv: {}
    }
  }
}
```

**⚠ `buildLaunch` READS `spec.cwd` AND NOTHING ELSE**, and the test in §8 proves it by building with
every optional field populated and asserting the request is unchanged. `credential`, `route`,
`modelId`, `effortOptionId`, `permissionModeId`, `resume`, `extraArgs` and `hookUrl` are all present on
`PtyLaunchSpec` (`types.ts:439`–`:500`) and all ignored here. **An adapter that never reads a field
cannot leak it** — which is why the ignoring is asserted rather than trusted.

**On the environment, stated so a reviewer does not have to re-derive it:** with `secretEnv` empty,
`composeChildEnv` (`env.ts:143`) takes the **no-credential** branch and inherits `process.env`
wholesale plus `PINNED_ENV_VARS`, exactly as every subscription-auth launch does today. Nothing is
registered with the PTY scrubber — **correct, because there is nothing to scrub.** **This is not a new
exposure**: a user's own shell already sees their own environment, and Chorus is not adding one
variable to it. The one thing that *would* be new is a decrypted vault key, and §5 refuses it.

---

## §2 — `src/shared/ipc.ts` — `agentKindSchema`

**One line, at `:902`**, plus the docblock paragraph the four kinds before it each received (`:880`–
`:901` carries kimi's, opencode's and grok's):

```ts
export const agentKindSchema = z.enum(['claude', 'codex', 'grok', 'kimi', 'opencode', 'shell'])
```

**⚠ `'shell'` GOES LAST IN THE ENUM AND THAT IS COSMETIC — `DETECTED_TOOLS` (§4) IS WHAT ORDERS THE
CARDS.** `adapters.test.ts:845` sorts both sides before comparing, so enum order is not load-bearing
anywhere. Placing it last keeps the diff to one token.

The paragraph to add above it, in the voice of `:895`–`:901`:

```
 * The SHELL — a real PowerShell in a pane, labelled `Terminal` (D185,
 * 2026-08-26). Not an agent, and deliberately modelled as one anyway: a
 * `session.kind` discriminator would say so structurally and cost the DB
 * schema, the wire and every session surface, to buy a distinction the
 * adapter's six null capabilities already enforce at every call site. See
 * `shell.ts` — `pwsh` falling back to `powershell` through the existing
 * `resolveCli()`, no auth methods, and a `session:launch` refusal (main/ipc.ts)
 * for any launch that tries to hand it a key.
```

**⚠ THIS EDIT AND §3 ARE ONE CHANGE.** Do not commit one without the other; see §3.

---

## §3 — `src/main/adapters/registry.ts`

Two edits. The import beside the other five (`:2`–`:6`), and the sixth entry at `:40`–`:46`:

```ts
import { shellAdapter } from './shell'
…
export const staticRegistry: Readonly<Record<AgentKind, AgentAdapter>> = Object.freeze({
  claude: claudeAdapter,
  codex: codexAdapter,
  grok: grokAdapter,
  kimi: kimiAdapter,
  opencode: opencodeAdapter,
  shell: shellAdapter
})
```

and a fourth ⚠ paragraph in the docblock, after D165's at `:28`–`:30`, in exactly its shape:

```
 * ⚠ D185 (2026-08-26): FIVE BECAME SIX — `shell`, a real PowerShell in a pane
 * labelled `Terminal`, so Phase 7a's Workbench preset has something to launch.
 * Same rule again; `agentKindSchema` widened in the SAME change, and the
 * compiler walked the `Record<AgentKind, …>` sites as before. ⚠ THE FIRST
 * ENTRY WHOSE `id` IS NOT A BINARY NAME: `resolveCli(adapter.id)` is correct
 * for the five above and WRONG for this one, which is why `shell.ts` resolves
 * `pwsh`/`powershell` through its own helper. Anything here or in the test
 * suite that derives a command from an adapter's id must skip it — see
 * `adapters.test.ts`'s `expectedArgs`.
```

**⚠ THE WIDEN-TOGETHER RULE IS NOT SATISFIED BY THE COMPILER CATCHING YOU AFTERWARDS.** `:31`–`:38`
already argues this at length: F25's defect is a tree in which one moved and the other did not, and
`layout:get`'s filter (`main/ipc.ts:3855`) treats **registry membership as proof of schema validity** —
so a kind in the registry and not in the enum passes the filter and then fails the outbound parse,
taking the whole project's layout response down over one row. The `Record<AgentKind, …>` type makes
that a build failure **in both directions**; the discipline is to make it one edit, in one commit, so
no intermediate tree exists.

---

## §4 — `src/main/services/cliDetect.ts` — `DETECTED_TOOLS`

**One entry, at `:145`–`:154`, after `'grok'` and before `'git'`:**

```ts
export const DETECTED_TOOLS = [
  'claude',
  'codex',
  'kimi',
  'opencode',
  'grok',
  'shell',
  'git',
  'docker',
  'node'
] as const
```

and the comment block at `:135`–`:144` gains its fifth note, in D165's shape:

```
// D185: 'shell' joins them, LAST among the agents and BEFORE the plain tools,
// because that is exactly what it is — the agent cards read
// claude · codex · opencode · grok · Terminal (kimi's card is withheld by
// LaunchDialog's presentation filter) and git/docker/node stay behind them.
// ⚠ IT IS AN AGENT PROBE RATHER THAN A PLAIN TOOL ONLY BECAUSE `getAdapter`
// ANSWERS FOR IT (probeAll, below). That is the whole mechanism: registering
// the adapter is what moves 'shell' from `detectOne` — which would report
// `agentKind: null` and be filtered out of the launch dialog at
// LaunchDialog.vue:516 — onto `detectViaAdapter`.
```

**⚠ `detectViaAdapter` (`:205`) CASTS `adapter.id as AgentKind` WITH THE COMMENT "registry membership
proves this".** That comment stays true only because §2 and §3 moved together. It is a third,
quieter consequence of F25 and worth reading before touching either file.

**Why not a plain tool.** `detectOne` (`:196`–`:202`) returns `agentKind: null` and no `displayName`,
and `LaunchDialog.vue:516` filters those out — so a `shell` added here **without** the registry entry
would probe successfully and never render a card, which is the failure mode that looks like "the
detection is broken" and is not.

---

## §5 — `src/main/ipc.ts` — the refusal

**Exact position: immediately after the existing mutual-exclusion refusal at `:1697`–`:1699`**, inside
the `SessionLaunch` handler, **before** `resolveLaunchProfile` and before any credential is decrypted.
`staticRegistry` is already imported at `:276`, and `req.agent` is an `AgentKind` by the time
`launchRequestSchema.parse` has run at `:1661` — so the lookup is total and needs no `?? null`.

```ts
    // D185: an adapter that cannot take an API key must never be HANDED one.
    //
    // ⚠ THIS IS THE ONE THING THE ADAPTER ROUTE DOES NOT GIVE FOR FREE.
    // `shell.ts` declares `getAuthMethods(): []`, so the launch dialog never
    // OFFERS a credential — but the dialog is not the security boundary, main
    // is. Both fields below are reachable today: picking a launch profile sets
    // the agent (LaunchDialog.vue:447), and clicking a different agent card
    // afterwards does NOT clear `selectedLaunchProfileId`, so
    // profile-then-Terminal-then-Launch arrives here with `agent: 'shell'` and
    // a profile main would resolve to a decrypted key.
    //
    // ⚠ WHY THAT MATTERS IN ONE SENTENCE: a decrypted API key injected into a
    // raw shell is readable by the human at the prompt (`echo
    // $env:ANTHROPIC_API_KEY`) — every other adapter hands its key to a CLI
    // that SPENDS it, this one would hand it to a PERSON.
    //
    // ⚠ KEYED ON THE CAPABILITY, NOT ON `req.agent === 'shell'`, SO IT
    // GENERALISES. The string form protects exactly one adapter and passes
    // every test written for it; D185 asked for the general rule by name.
    // ⚠ AND THE PREDICATE REACHES kimi TOO (`kimi.ts:94` — no `--api-key`
    // flag and no env var to receive one). That is deliberate and MEASURED,
    // not overlooked: the launch_profiles census on <DATE> found <N> kimi
    // profiles across the dev and installed databases. A key that reaches kimi
    // is ignored by kimi and gains nothing but exposure, so refusing it is
    // strictly better there too.
    const requested = staticRegistry[req.agent]
    if (
      requested.getCapabilities().apiKey === false &&
      (req.credential_profile_id || req.launch_profile_id)
    ) {
      return {
        ok: false,
        reason: `${requested.displayName} takes no credential or launch profile — a key injected into a shell is readable by whoever is at the prompt.`
      }
    }
```

**⚠ THE REASON STRING IS THE FEATURE, NOT DECORATION.** A user who hits this refusal learns *why* from
that sentence and nowhere else; `'Invalid launch'` would leave them clicking Launch again. It reads in
the same register as its neighbour (`'Pick a launch profile or a credential, not both.'`) and it names
the adapter through `displayName`, so a future no-auth adapter gets a correct sentence with no edit.

**⚠ AND IT RETURNS BEFORE ANY ROW OR PTY EXISTS.** That is why the position matters: `:1677`–`:1683`
already states the discipline for the credential path — *"resolve + decrypt the credential BEFORE any
session row is created — a refusal here leaves no orphan row"* — and this guard sits above even that.
A refusal that left a session row behind would be a worse bug than the one it prevents.

**If §0(5)'s census came back non-zero for kimi**, split the two halves as §0(5) specifies and say so
in the comment. **The predicate does not change either way.**

### What this guard does NOT do, stated so nobody adds it

- **It does not touch the activity mechanism.** `shell` declares `hooks: null`, so
  `sessionManager.ts:820` registers the session **output-driven** (D183) and its pane's light is minted
  from PTY output on the 10-second `OUTPUT_STALE_MS` window. A shell echoes keystrokes, so the bar
  lights while a human types. **That is D183 working; it is not this task's to change.** The pane still
  has three states, never `needs-you` — that rides the hook bus, which this adapter does not have.
- **It does not refuse a `workspace_mode`.** `worktreeSafe: true` is honest: a worktree is a directory
  and a shell takes a cwd.
- **It does not validate the shell's existence.** `buildLaunch` throws if nothing resolves, and that
  reaches the dialog as an inline error like every other missing CLI.

---

## §6 — The four `Record<AgentKind, string>` label maps — `src/main/services/notifications.ts` · `src/renderer/src/palette/commands.ts` · `src/renderer/src/components/FilmstripRenderer.vue` · `src/renderer/src/components/TerminalPane.vue`

**One line each, and the compiler will name all four for you.** They are one section because they are
one edit repeated: the same key, the same value, the same reason. **The label is `Terminal` because
that is the adapter's `displayName`**, and `notifications.ts:10` already states the rule — *"Labels
mirror each adapter's own `displayName`."* Do not spell it differently in any of the four; a toast that
says "Shell" and a pane header that says "Terminal" are two names for one thing.

### `src/main/services/notifications.ts` — `AGENT_LABELS` (`:11`)

```ts
const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  grok: 'Grok', // D165
  kimi: 'Kimi Code',
  opencode: 'opencode',
  shell: 'Terminal' // D185
}
```

**⚠ THE COMPILER FOUND THIS FILE, AND `:6`–`:10` SAYS THAT IS THE POINT** — *"D86 added 'kimi' and the
COMPILER found this file; D90 added 'opencode' and it found it again; D165 added 'grok' and it found it
a third time. That is the property working, not a chore."* Extend that sentence with D185's fourth
instance rather than leaving a list that stops at three.

### `palette/commands.ts:49` · `FilmstripRenderer.vue:88` · `TerminalPane.vue:71`

Three more `Record<AgentKind, string>` maps, one line each:

```ts
  shell: 'Terminal' // D185
```

### ⚠ And `TerminalPane.vue:112` gets NOTHING

```ts
const USER_ROW_MARKER: Partial<Record<AgentKind, string>> = {
  claude: '❯'
}
```

It is `Partial<…>`, so the compiler will not ask — and `:107`–`:109` states the rule it is asking you
to follow: *"AN AGENT WITH NO ENTRY HERE RENDERS EXACTLY AS IT DOES TODAY. That is the intended state
for an unmeasured agent … rather than a fallback that guesses a marker and mis-colours the agent's own
output."* Every entry in that map is measured from a real node-pty capture under Chorus's pinned env.
**A shell has no author glyph to measure** — `PS C:\…>` is a prompt, not an authorship marker, and
tinting a row that begins with it would colour the user's *and* the command's output identically.
Leave it empty and say so in the report, because "I did not add it" and "I forgot it" look the same in
a diff.

**⚠ If 7a-1 has not landed** (§0(6)), the `codes` maps in `FilmstripRenderer.vue` and `TerminalPane.vue`
— and the one in `LaunchDialog.vue` — are also `Record<AgentKind, string>` and the typecheck will flag
them. `shell: '>_'` in each, and nothing more.

---

## §7 — `src/renderer/src/components/LaunchDialog.vue`

**Two behaviours. No glyph code, no capability control, and no change to `submit()`'s payload
spread** — the phase's purity contract item 3 makes that spread untouchable, and 7a-3 is about to wrap
it in a loop.

### (a) The name suggestion, withheld

`suggestAgentName` (`shared/agentNames.ts:71`) picks from a 40-name pool of first names so that
*"'Claude Code — Bob' and 'Claude Code — Ruth' are told apart at a glance in a rail of eight identical
agent labels"* (`:10`–`:14`). **A terminal called "Bob" is noise**: the pane already reads `Terminal`,
which is correct, unambiguous and needs no help.

**⚠ KEY IT OFF A NAMED KIND LIST, NOT OFF A CAPABILITY**, in `HIDDEN_AGENTS`'s idiom (`:512`):

```ts
/**
 * Kinds the name suggestion is withheld for: a pane whose LABEL already is its
 * identity.
 *
 * ⚠ A PRESENTATION CHOICE, KEYED ON THE KIND ON PURPOSE. There is no
 * capability that means "this is not a person", and inventing one to carry a
 * naming preference would put a UI opinion into the adapter contract, where
 * D34 Q1 says only MEASURED FACTS ABOUT A CLI belong. `HIDDEN_AGENTS` above
 * makes the identical trade for the identical reason.
 *
 * The field stays EDITABLE — a user who wants to name their terminal may. Only
 * the SUGGESTION and its reroll control are withheld.
 */
const UNNAMED_AGENTS: readonly AgentKind[] = ['shell']
```

The three requirements, however the state is written — **the sketch is deliberately incomplete so the
implementer picks one shape and writes it clearly**:

1. **Selecting Terminal never leaves a person's name in a field the user did not type.** The prefill at
   `:591` is made once per open, after `selected` is set at `:585`, so the mount path is a conditional;
   the *switch* path needs a watcher.
2. **Text the user typed is never destroyed by an agent switch.** Track whether the field currently
   holds an untouched suggestion (set on the two writes at `:94` and `:591`, cleared on the input's
   `@input`), and only ever clear a suggestion.
3. **Switching away from Terminal restores what was suppressed, verbatim** — not a fresh
   `suggestAgentName()` roll. A name that changes under the user for no reason is worse than no
   suggestion at all.

And **the reroll glyph does not render** while an `UNNAMED_AGENTS` kind is selected — `v-if` on the
button at `:916`–`:920`, **absent, not disabled**, the standing rule at `:158`–`:167`. A greyed dice
with no explanation is exactly the dead UI that rule bars.

### (b) The Auth control, absent when there is nothing to authenticate

Today the "Auth" section (`:959`–`:978`) renders a lone `subscription` segment whenever the api-key
segment is hidden — and for Terminal that is a control with nothing behind it, on the one card whose
answer is *"there is no auth here"*. `authChoice` stays `'subscription'` and `submit()` sends nothing
either way (`:737`–`:742`), so **this is a rendering fix with no wire consequence.**

```ts
/**
 * The selected adapter's declared auth methods — `null` while `adapter:list`
 * is still in flight.
 *
 * ⚠ THREE STATES, NOT TWO, AND THE `?? []` FORM IS THE BUG. `adapters` is
 * empty until `adapter:list` lands (:534), so an `?? []` default would read
 * "no auth methods" for EVERY agent for the first frames and blink the Auth
 * control out and back in on every dialog open. This is
 * `AdapterAuthoring.md`'s null-vs-undefined rule applied to a render
 * decision: `null` = not probed (render), `[]` = probed and EMPTY (hide).
 */
const selectedAuthMethods = computed<readonly AuthMethodDefinitionWire[] | null>(
  () => adapters.value.find((a) => a.id === selected.value)?.authMethods ?? null
)
```

and the **section** — not the row, because the Model section shares it (`:1000`) — gains:

```html
<div v-if="selectedAuthMethods === null || selectedAuthMethods.length > 0" class="launch-section">
  <span class="overlay-label">Auth</span>
  …
```

**Alternatives named and rejected:** keying it on `apiKey === false || subscriptionLogin === false`
would hide the control for **kimi** too, which has a real subscription login and no key path — the
control is correct there. Leaving it as-is was considered and rejected because the phase's own purity
contract item 4 names "a Terminal card renders no model, effort or permission control" as the standard,
and an auth segment with one dead button is the same defect wearing a different label.

### (c) What must NOT change here

- **`submit()`'s `...(x ? {k:x} : {})` spread** (`:724`–`:767`) — purity contract item 3, and 7a-3
  depends on it byte-for-byte.
- **`HIDDEN_AGENTS`** — `shell` is not hidden; that is the whole point of the card.
- **The default selection** — `:585` picks the first *found* agent, which is claude, and adding a sixth
  entry at the end of `DETECTED_TOOLS` must not move it. Verify in the drive.
- **The `codes` map / any mark** — 7a-1's, unless §0(6) says otherwise.

---

## §8 — `src/main/adapters/adapters.test.ts`

**Four additions and nothing else**: a new `describe('shell (D185)')` **after grok's block (`:825`)**
and in that block's shape, one row in each of the three hand-maintained tables, and one line in the
hand-written `supportsInstructions` case at `:1902`. **`const adapters` (`:59`) and the `it.each` at
`:1488` are not touched** — task fact 1 is why, and both crash rather than fail if they are.

```ts
describe('shell (D185)', () => {
  const SPEC = { sessionId: 's', cwd: 'C:\\Projects' } as const
  const CANARY = 'sk-canary-do-not-leak-7a2'

  it('declares the identity the registry pins', () => {
    expect(shellAdapter.id).toBe('shell')              // adapters.test.ts:448 pins this too
    expect(shellAdapter.displayName).toBe('Terminal')  // the label every Record<AgentKind,string> mirrors
    expect(shellAdapter.executionMode).toBe('pty')
    expect(shellAdapter.requiredEnvVars).toEqual([])
  })

  it('offers NO auth method — the empty list IS the declaration', () => {
    // An equality, not a length: a method added later must fail HERE and be
    // argued for, because `getAuthMethods()` is what stops the dialog offering
    // a credential in the first place.
    expect(shellAdapter.getAuthMethods()).toEqual([])
  })

  it('declares all SIX descriptors null — individually, so one cannot be dropped', () => {
    const caps = shellAdapter.getCapabilities()
    // ⚠ SIX SEPARATE ASSERTIONS RATHER THAN ONE toEqual ON THE OBJECT, so
    // removing a null cannot pass under cover of the others.
    expect(caps.reasoningEffort).toBeNull()
    expect(caps.permissionMode).toBeNull()
    expect(caps.sessionResume).toBeNull()
    expect(caps.mcp).toBeNull()
    expect(caps.hooks).toBeNull()
    expect(caps.instructions).toBeNull()
  })

  it('declares the five booleans exactly', () => {
    const caps = shellAdapter.getCapabilities()
    expect(caps.interactiveTerminal).toBe(true)
    expect(caps.worktreeSafe).toBe(true)
    expect(caps.skills).toBe(false)
    expect(caps.subscriptionLogin).toBe(false)
    // ⚠ THE ONE main/ipc.ts KEYS ITS REFUSAL ON. Flipping it to true silently
    // disarms that guard, which is why it is asserted here as well as implied
    // by the descriptor loop.
    expect(caps.apiKey).toBe(false)
  })

  it('every capability guard narrows to false', () => {
    expect(supportsMcp(shellAdapter)).toBe(false)
    expect(supportsHooks(shellAdapter)).toBe(false)
    expect(supportsResume(shellAdapter)).toBe(false)
    expect(supportsInstructions(shellAdapter)).toBe(false)
  })

  it('buildLaunch spawns the resolved shell and contributes NOTHING of its own', () => {
    const req = shellAdapter.buildLaunch(SPEC)
    // Asserted against the LIVE resolver, never a literal path — :216's rule:
    // "a literal expectation would silently encode this machine's install
    // layout … and pass on a machine where the CLI resolves differently."
    // ⚠ AND THE RESOLVER IS THE ADAPTER'S OWN, NOT `resolveCli(adapter.id)` —
    // `resolveCli('shell')` throws; that is the whole shape of this adapter.
    const cli = resolveShell()
    expect(cli).not.toBeNull()   // powershell.exe is in System32 on every supported Windows
    expect(req.executable).toBe(cli!.file)
    expect(req.args).toEqual([...cli!.args])   // [] on a real .exe — §0(3)
    expect(req.cwd).toBe(SPEC.cwd)
    expect(req.envAdditions).toEqual({})
    expect(req.secretEnv).toEqual({})
  })

  it('⚠ IGNORES A CREDENTIAL COMPLETELY — the canary that makes the refusal defence-in-depth', () => {
    const req = shellAdapter.buildLaunch({
      ...SPEC,
      credential: { envVarName: 'ANTHROPIC_API_KEY', value: CANARY, isSecret: true },
      route: { providerKey: 'p', providerName: 'n', baseUrl: 'https://x', modelId: 'm' },
      modelId: 'm',
      effortOptionId: 'deep',
      permissionModeId: 'auto',
      extraArgs: ['--whatever']
    })
    expect(req.secretEnv).toEqual({})
    // The strongest form: the value cannot be anywhere in the request at all.
    expect(JSON.stringify(req)).not.toContain(CANARY)
    // …and nothing else moved either: every optional field above is ignored.
    expect(req).toEqual(shellAdapter.buildLaunch(SPEC))
  })

  it('is a VALID AdapterDescriptor on the wire — all-null, no-auth, no schema change', () => {
    // The same parse `adapter:list` performs (main/ipc.ts:3820), so a
    // declaration the wire cannot carry fails HERE rather than at the first
    // dialog open. This case is what makes the task's "no wire change"
    // non-goal true rather than assumed.
    const parsed = adapterDescriptorSchema.safeParse({
      id: shellAdapter.id,
      displayName: shellAdapter.displayName,
      executionMode: shellAdapter.executionMode,
      authMethods: shellAdapter.getAuthMethods(),
      capabilities: shellAdapter.getCapabilities()
    })
    expect(parsed.success).toBe(true)
  })
})
```

**The three table rows** — placed with their neighbours, each carrying its reason:

```ts
  // in RESUME_SUPPORT (:934)
  // D185: there is no conversation to resume. A shell's history is the user's
  // own PowerShell history file, which Chorus neither owns nor reopens, and a
  // restart gives a fresh prompt exactly as it gives every agent a fresh
  // conversation (D142). NOT "not yet" — the same distinction kimi's and
  // opencode's rows draw one line up.
  shell: false

  // in MCP_SUPPORT (:990)
  // D185: there is no agent here to give tools to. ⚠ DISTINGUISH THIS FROM
  // grok's false above, which means UNMEASURED — this one means INAPPLICABLE,
  // and the two are the same boolean for opposite reasons.
  shell: false

  // in HOOKS_SUPPORT (:1037)
  // D185: no lifecycle events, because there is no agent lifecycle. The pane
  // keeps exactly three states (D129). ⚠ Note this makes the session
  // OUTPUT-DRIVEN at spawn (sessionManager.ts:820, D183), so its bar lights
  // from the user's own keystrokes — measured, expected, and not this
  // adapter's to change.
  shell: false
```

**And the one line with no guard behind it** — `:1902`'s hand-written case:

```ts
    expect(supportsInstructions(shellAdapter)).toBe(false)
```

**⚠ Nothing else in `adapters.test.ts` moves.** `git diff` on that file must show **zero deleted
lines**.

---

## §9 — Verification

### Build

```powershell
New-Item -ItemType Junction -Path .\node_modules -Target C:\Projects\ContactEstablished\Chorus\node_modules
npm run typecheck        # 0, node + web
npx vitest run           # >= your §0(1) baseline (2941 / 78 + 1 uncollected), plus this task's cases
npm run grep:secrets     # clean, 6 patterns
(Get-Item .\node_modules).Delete()   # ⚠ link-aware: a recursive force-delete can delete THROUGH a junction
```

### Structural

```powershell
# the three counters this task must NOT move — re-run §0(2) verbatim: 22 / 110 / 9

# the two vocabularies moved TOGETHER (one commit, both files)
git show --stat HEAD | Select-String "shared/ipc.ts|adapters/registry.ts"

# the compiler-enforced label maps all say Terminal — expect FOUR hits
Get-ChildItem -Path src -Recurse -Include *.ts,*.vue | Select-String -Pattern "shell: 'Terminal'"

# and USER_ROW_MARKER gained nothing
Select-String -Path src/renderer/src/components/TerminalPane.vue -Pattern "USER_ROW_MARKER" -Context 0,6

# the adapter reads nothing it should not: the ONLY permitted hit is `secretEnv: {}`
Select-String -Path src/main/adapters/shell.ts -Pattern "credential|buildSecretEnv|secretEnv|route|modelId|effort|permission|resume|extraArgs"

# the guard is keyed on the CAPABILITY, and `ipc.ts` names no kind
Select-String -Path src/main/ipc.ts -Pattern "apiKey === false" -Context 8,12
Select-String -Path src/main/ipc.ts -Pattern "'shell'"          # expect ZERO hits

# adapters.test.ts: three rows added, `const adapters` untouched
Select-String -Path src/main/adapters/adapters.test.ts -Pattern "^\s+shell: (true|false)"   # expect 3
Select-String -Path src/main/adapters/adapters.test.ts -Pattern "^const adapters"           # expect the ORIGINAL line
git diff src/main/adapters/adapters.test.ts | Select-String "^-"                            # expect ZERO deletions

# nothing outside the Exact Scope list
git diff --stat
```

### Runtime — the part that decides the task

Evidence under `_verify/7a-2/`. A real window on a `--user-data-dir` **seeded from
`%APPDATA%\chorus-app`** — the dev DB carries no credentials, and step 6 needs one — driven over CDP on
**port 9333, never 9222** (9222 is the installed instance).

1. **The card.** Open the launch dialog and read the agent grid from the DOM, not from a screenshot.
   **Terminal is LAST among the agent cards**, labelled `Terminal`, carrying `>_`; `git`, `docker` and
   `node` are not cards at all (`agentKind: null`, filtered at `:516`). **And claude is still the
   default selection.** Capture both the DOM text and a screenshot.
2. **The absences.** Select Terminal, then assert each of these selectors is **absent from the DOM**,
   not merely hidden — `display:none` and absent look identical in a screenshot and only one of them
   satisfies `:158`–`:167`:
   - `[data-launch-model]` / the Model section,
   - the effort segment (`v-if="effortLevels.length > 0"`, `:1058`),
   - the permission segment (`:1126`),
   - the Auth section (§7(b)),
   - `.launch-reroll` (§7(a)).

   **And the Name field's value is the empty string, not a name from the pool.** Switch to claude and
   back and confirm the round trip: the suggestion returns **identical**, and text you typed yourself
   survives in both directions.
3. **Launch it**, `workspace_mode: current-tree`. A prompt appears. Run `git status`; capture the
   output. Then run `$PSVersionTable.PSVersion` **in the pane** and record which binary resolved —
   this is the drive asking a question the app deliberately does not (§1's `version: null`).
4. **Restart it** (`session:restart`). A fresh prompt, no resumed history — the same thing a restart
   gives every agent (D142). Confirm the pane's row id did not change.
5. **Quit and reopen the app.** **The pane restores** — a fresh shell under the same session row.
   ⚠ **This is the observation that proves the Goal's central claim**: that the adapter route bought
   the entire session lifecycle without one line of shell-specific code. If it does not restore, the
   design claim is wrong and that is a **stop and report**, not a patch.
6. **⚠ THE NEGATIVE DRIVE — THE STEP THIS TASK EXISTS FOR.** In the seeded profile, select a
   **credential-bearing launch profile**, then click **Terminal**, then Launch.
   - **Main refuses**, and the authored sentence renders inline (`:768`–`:771`). **Paste it verbatim.**
   - **No session row was created and no PTY was spawned** — the guard returns above `sessions.launch`.
     Confirm the project's pane count is unchanged and read the `sessions` table from a **copy** of the
     DB (Electron-as-node, as in §0(5)) to prove no orphan row exists. **A refusal that leaves a row is
     a failed step**, and `:1677`–`:1683` is the standard it is measured against.
   - Repeat with a **bare credential** (`credential_profile_id`, no profile) to prove both fields are
     covered.
7. **The control case.** Launch **claude** with the same credential-bearing profile in the same
   project. It succeeds exactly as it does today. **Without this, step 6 proves only that something is
   broken.** Then confirm the reverse control: a **Terminal launch with no profile and no credential**
   succeeds, so the guard refuses the payload and not the kind.
8. **The activity light.** Type in the Terminal pane and watch the rail. It lights while output flows
   and goes out roughly ten seconds later (`OUTPUT_STALE_MS`, D183). **Record it; change nothing.**
   Confirm the pane shows three states and never `needs-you`.

**⚠ Failure-honesty clause.** Any command that fails — a missing CLI, a locked DB, a CDP port already
held, an ABI mismatch, Windows PATH weirdness — is reported **with its output**, and the step is **not
claimed**. Environmental failure is a legitimate result; a silently skipped step is not.

### The invariants a reviewer should test hardest

**Three, and the second is the one that fails silently.**

1. **NO CREDENTIAL CAN REACH A SHELL, AND THE PROOF IS STRUCTURAL RATHER THAN REVIEWED.** Two
   independent mechanisms, and a reviewer must confirm **both**, because either alone is one edit from
   useless. **(i)** `main/ipc.ts` refuses the payload — read the guard, confirm it is keyed on
   `apiKey === false`, confirm it sits above `resolveLaunchProfile`, and confirm the drive's step 6
   actually returned `ok: false`. **(ii)** `shell.ts` returns a **literal** `secretEnv: {}` and never
   mentions `spec.credential` — so even a guard that is one day moved, narrowed or reordered cannot put
   a key into that child's environment. Grep both. **The canary test (§8) is what makes (ii) a
   property rather than a promise**: it builds with a credential whose value is a distinctive string
   and asserts the string appears nowhere in `JSON.stringify(request)`.

2. **THE THREE HAND-MAINTAINED TABLES ARE `Record<string, boolean>`, SO THE COMPILER IS NOT WATCHING
   THEM — AND A FOURTH SITE IS NOT WATCHED AT ALL.** `RESUME_SUPPORT` (`:934`), `MCP_SUPPORT` (`:990`)
   and `HOOKS_SUPPORT` (`:1037`) each have a `names EVERY registry adapter` guard, so a missing row
   goes **red** — loud, and fine. **`:1902`'s hand-written `supportsInstructions` case has no such
   guard**: omit `shell` there and the suite stays **green while covering less**, which is Overview
   FINDING 1's exact shape (*"the failure mode that let kimi and opencode go through three phases
   without ever seeing capability honesty"*). Read the diff for four additions, not three. And check
   the *reasons*: the file's own standard is that *"each `false` … is a MEASURED position with a reason
   attached, not a default"*, and `shell`'s three falses are **inapplicable**, which is a different
   claim from grok's **unmeasured** and must not be copied from grok's comment.

3. **`const adapters` (`:59`) AND THE `it.each` AT `:1488` MUST BE UNTOUCHED, AND THE FAILURE IF THEY
   ARE NOT LOOKS LIKE SOMETHING ELSE.** Both crash rather than fail: `:258` dereferences
   `reasoningEffort!` (null here) and `expectedArgs` (`:162`) calls `resolveCli(adapter.id)` — which for
   `'shell'` **throws**, because the id is a registry key and not a binary. A suite that dies during
   `describe.each` collection reports an error that looks unrelated to this task, and the temptation is
   to "fix" it by relaxing the assertion or by giving `shell` a fake `reasoningEffort`. **Both are
   wrong.** `shell` belongs to `capabilityAdapters` (derived, automatic) and to the three tables, and to
   nothing else. Check by **diff**, not by test result.

---

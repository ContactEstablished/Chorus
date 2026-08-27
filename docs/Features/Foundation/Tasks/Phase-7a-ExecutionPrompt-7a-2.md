# Phase 7a — Execution Prompt (Task 7a-2 — `shell` as an agent kind)

_Generated 2026-08-27 against `chorus/Chorus/2be8b104` at `c484a0e`. **Paste the body below into a
fresh conversation** — it is self-contained and assumes no prior context. Every line number in it was
RE-MEASURED at `c484a0e`, after Task 7a-1 landed and shifted several of them; re-confirm each before
editing, since any edit you make shifts them again._

---

## 1. Role

You are the Coordinator for **Chorus — Phase 7a, Task 7a-2 (`shell` as an agent kind)**. The repo root is `C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104`. This is a **git worktree**, not the main checkout — run everything from there and do not `cd` to the original repo root. The expected branch is **`chorus/Chorus/2be8b104`** (confirm with `git branch --show-current`; do not switch without instruction). Expected HEAD is **`c484a0e`**. Platform is **Windows 11, PowerShell**.

## 2. Goal

Add a `Terminal` option that launches a real shell in a pane, so Workbench (Task 7a-3) becomes buildable. Two prime constraints drive this: **`agentKindSchema` and `staticRegistry` widen in the SAME change** (F25), and **`session:launch` gains exactly one refusal and nothing else**. There is **no migration** — `sessions.agent` is unconstrained TEXT.

## 3. Ground yourself first

Read in order, in full: `docs/Features/Foundation/Tasks/Phase-7a-Overview.md` · `docs/Features/Foundation/Tasks/Task-7a-2.md` (**including its `### ⚠ Six facts that will cost a session if they are not believed`**) · `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-7a-2.md` (**its `§0` probes run BEFORE any edit**).

⚠ **Task-7a-2.md's own *Initial Starting Point* is dated `3c70e87` and several of its line numbers are now STALE.** The table below supersedes it:

| What | Where, re-measured at `c484a0e` |
|---|---|
| `agentKindSchema` (the union to widen) | `src/shared/ipc.ts:902` — unchanged |
| `staticRegistry` (the registry to widen) | `src/main/adapters/registry.ts:40` — unchanged |
| the widen-together docblock / F25 warning | `registry.ts:10` and `registry.ts:33` |
| `AgentCapabilities` (six required-nullable descriptors) | `src/main/adapters/types.ts:45` — unchanged |
| `grokAdapter` (the model to copy) | `src/main/adapters/grok.ts:47`; `getAuthMethods` `:71`; `buildLaunch` `:141` |
| `kimi`'s `apiKey: false` (the predicate's other match) | `src/main/adapters/kimi.ts:94` — unchanged |
| `pickSpawnable` / `resolveCli` / `DETECTED_TOOLS` / `detectViaAdapter` | `src/main/services/cliDetect.ts:36` / `:117` / `:145` / `:205` |
| `AGENT_LABELS` (compiler-enforced) | `src/main/services/notifications.ts:11` — unchanged |
| output-driven activity registration | `src/main/services/sessionManager.ts:811` |
| `LAUNCH_PANE_CAP` | `src/main/ipc.ts:366` — unchanged |
| the mutual-exclusion refusal (where D185's guard goes beside it) | `src/main/ipc.ts:1698` |
| `sessions.agent` is TEXT | `src/main/db/schema.ts:73` — unchanged |
| `labels` maps (compiler-enforced, all three) | `palette/commands.ts:49` · `FilmstripRenderer.vue:89` · `TerminalPane.vue:72` |
| `USER_ROW_MARKER` — `Partial<>`, **NOT** enforced, deliberately gets no shell entry | `TerminalPane.vue:109` |
| `HIDDEN_AGENTS` / the `agentKind !== null` filter | `LaunchDialog.vue:513` / `:517` |
| the absent-not-disabled rule | `LaunchDialog.vue:160` |
| `suggestAgentName` usage (the prefill to suppress for shell) | `LaunchDialog.vue:592` |
| a launch profile sets the agent | `LaunchDialog.vue:448` |
| `submit()` still sends `launch_profile_id` | `LaunchDialog.vue:730` |
| F103's fixture read | `src/main/services/codeIndexCore.test.ts:42` |

⚠ **Task 7a-1 has LANDED (`c2fe8dd`) and this changes what you touch.** The three `codes` maps are **gone** from `LaunchDialog.vue`, `FilmstripRenderer.vue` and `TerminalPane.vue` — **verified absent** — so this task touches **no `.vue` glyph code at all**. `src/renderer/src/components/AgentMark.vue` exists and **already contains the `shell` mark**, so **7a-2 does not need to touch it**. Its `AgentMarkName = AgentKind | 'shell'` alias becomes redundant once this task widens the enum; simplifying it to `AgentKind` is **optional and cosmetic**, not required.

Git checks before the first edit:
```powershell
git branch --show-current      # expect chorus/Chorus/2be8b104
git log -1 --oneline           # expect c484a0e
git status --porcelain
```

## 4. ⚠ Pre-existing changes — do not revert, stage, commit or delete

`git status --porcelain` at hand-off shows exactly one line:
```
 M .mcp.json
```

Its **content matches HEAD**; it is stored LF in a working tree where `core.autocrlf = true`, so git reports it modified forever. **Leave it.** It is not yours, it is not part of your commit, and "cleaning the tree" before starting is wrong. Everything else from Phase 7a is already committed (`c2fe8dd` the marks, `c484a0e` the docs). If you find anything else modified, **report it and stop** rather than absorbing it.

## 5. Implementation scope

**Create:** `src/main/adapters/shell.ts` — a `PtyAgentAdapter` modelled on `grok.ts`. Set `id: 'shell'`, `displayName: 'Terminal'`, `executionMode: 'pty'`, `requiredEnvVars: []`. The `detectInstallation()` method resolves **`pwsh.exe` falling back to `powershell.exe`** through the existing `resolveCli()` machinery, reporting the resolved `path` and `version: null` (do not pay for a `$PSVersionTable` probe on every dialog open). `getAuthMethods()` returns `[]`. `getCapabilities()` returns `interactiveTerminal: true`, `worktreeSafe: true`, `skills: false`, `subscriptionLogin: false`, `apiKey: false`, and **all six descriptors explicitly `null`** (`reasoningEffort`, `permissionMode`, `sessionResume`, `mcp`, `hooks`, `instructions`). `buildLaunch(spec)` returns `{ executable, args, cwd: spec.cwd, envAdditions: {}, secretEnv: {} }` and reads no field of `PtyLaunchSpec` except `cwd`.

⚠ **`detectInstallation` MUST NOT probe its own `id`** — `resolveCli('shell')` **throws** (`cliDetect.ts:117-131`), because there is no `shell.exe`.

**Edit:** `src/shared/ipc.ts:902` (+`'shell'`) and `src/main/adapters/registry.ts:40` (+`shellAdapter`) **in the same change**; `cliDetect.ts:145` `DETECTED_TOOLS` (+`'shell'`, positioned **after `grok`, before `git`**, so the picker reads claude · codex · opencode · grok · Terminal); the three `Record<AgentKind, string>` label maps (label it **`Terminal`** everywhere); `src/main/ipc.ts` ~`:1698` for the refusal; and `adapters.test.ts` per §6 below.

**Quote D185 with its date:**

> **D185 — the shell is a real `AgentKind`, and main refuses to hand it a key. SETTLED 2026-08-26 (Matthew).** An adapter, not a `session.kind` discriminator: the discriminator would say structurally that a shell is not an agent, and it is rejected **on cost** — it touches the DB schema, the wire and every session surface to buy a distinction the six null descriptors already enforce at every call site. **`session:launch` must reject a launch where the agent's `getCapabilities().apiKey === false` and either `credential_profile_id` or `launch_profile_id` is present.** The reason in one sentence: **a decrypted API key injected into a raw shell is readable by the human at the prompt (`echo $env:ANTHROPIC_API_KEY`); every other adapter hands its key to a CLI that spends it, this one would hand it to a person.** `getAuthMethods()` returning `[]` means the dialog never offers it — **which is not the same as main refusing it, and the dialog is not the security boundary.**

⚠ **The predicate also matches **kimi** (`kimi.ts:94` declares `apiKey: false`), and the de-risking fact is critical:** the `launch_profiles` census decides whether D185's literal form is safe. **That census was run 2026-08-27 and both databases hold ZERO `launch_profiles` rows** — the installed DB (`%APPDATA%\chorus-app\chorus.db`) and the dev DB (`%APPDATA%\Chorus\chorus.db`). So D185's literal predicate ships with **no behaviour change for kimi, because there are no launch profiles at all**. **Re-run the census at pickup anyway** — it is a live table and a user may have created one since.

⚠ **And the measured path that makes the refusal non-theoretical:** picking a launch profile sets the agent (`LaunchDialog.vue:448`) but clicking a *different* agent card does **not** clear `selectedLaunchProfileId`, and `submit()` still sends it (`:730`). So profile → Terminal → Launch already reaches `session:launch` carrying a profile main would decrypt.

## 6. ⚠ `adapters.test.ts` — EIGHT sites, four kinds, and the compiler catches NONE of them

This section saves the session:

| Sites | Behaviour if you miss them |
|---|---|
| **3 GUARDED tables** — `RESUME_SUPPORT` `:934`, `MCP_SUPPORT` `:990`, `HOOKS_SUPPORT` `:1037`. Each needs a **`shell: false` row with a reason comment**. | **Fails loudly** — each is asserted against `Object.keys(staticRegistry)` at `:962`, `:1012`, `:1046`. The good case. |
| **2 UNGUARDED all-five lists** — the `it.each` at **`:1488-1494`** (*"a launch with NO resume modifier adds no resume tokens for %s"*) and the assertions at **`:1902-1908`** (*"supportsInstructions narrows on BOTH halves"*). Both need `shell` added. | **Fails SILENTLY** — no registry-coverage assertion, so the suite stays **green while covering less**. That is exactly the shape that let kimi and opencode pass through three phases without capability honesty. |
| **2 UNGUARDED subset lists** — `:1706-1710` (*"%s IGNORES a resume field it never declared"*) and `:2056-2060` (*"%s exposes no instructionsArgs at all"*), both currently `kimi` + `opencode`. | **A judgement call to make and record.** `shell` is *also* declared incapable on both axes (`sessionResume: null`, `instructions: null`), so it arguably belongs in both. Adding it strengthens coverage; omitting it leaves shell untested there, silently. **Decide deliberately and say which you did and why.** |
| **1 LEAVE-ALONE list** — `const adapters` at **`:59`** (`[claudeAdapter, codexAdapter, grokAdapter]`). | **⚠ DO NOT ADD `shell`.** It breaks **two** ways: the cases dereference the effort descriptor with a non-null assertion at **`:258`**, and the `expectedArgs()` helper at **`:162`** calls **`resolveCli(adapter.id)`**, which **throws** for a name not on PATH. kimi and opencode are already excluded for the first reason and the file says so. |

Also note `capabilityAdapters` (`:88`) is **derived from the registry** and needs no edit — `shell` joins it automatically because it is a PTY adapter — and that `:845` (`Object.keys(staticRegistry).sort()` vs `agentKindSchema.options`) and `:448` (`staticRegistry[kind].id === kind`) both stay green provided the union and registry widen together and the adapter's `id` is exactly `'shell'`.

## 7. Strict non-goals

- **No migration.** `MIGRATIONS.length` stays **22** — assert by AST-parsing `src/main/services/storage.ts:175`, never by grep (the comments *between* array elements contain backticks, so a character scanner returns garbage).
- **No new IPC channel.** `IpcChannel` stays **110**.
- **No new dependency.** `package.json` byte-identical.
- **No `.vue` glyph code.** `AgentMark.vue` already carries the `shell` mark; the `codes` maps are already gone.
- **No presets, no "how many", no batch launch** — Task 7a-3.
- **No widening of the `labels` maps' PURPOSE** — add the `Terminal` string, change nothing else.
- **No hook, MCP, instructions or resume support for `shell`** — all six descriptors are `null`, and `withMcpEnv` must write nothing for it.
- **No name suggestion for `shell`** — suppress the `suggestAgentName` prefill (`LaunchDialog.vue:592`); a terminal called "Bob" is noise and the pane reads `Terminal`.
- **Do not revert, stage or commit `.mcp.json`.**
- **Do not write D185 into `roadmap.md`** — already recorded there.

## 8. Verification commands

Runnable PowerShell from the repo root. **Step 0 and the final step are not optional and are not reorderable.**

```powershell
# 0. ⚠ A WORKTREE HAS NO node_modules. Without this EVERY gate below is a false green.
New-Item -ItemType Junction -Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" `
  -Target "C:\Projects\ContactEstablished\Chorus\node_modules" | Out-Null
if (-not (Test-Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules\.bin\tsc.cmd")) { throw 'junction missing — gates below would be a false green' }

npm run typecheck        # 0 errors, node + web. It will walk every Record<AgentKind,…> for you.
npx vitest run           # 2941 / 2941 across 78 files + 1 uncollected (F103 — EXPECTED) PLUS your new cases
npm run grep:secrets     # clean, 6 patterns
# There is NO `npm run lint` in this repo. Do not report one.
```

⚠ **The junction assertion:** `cmd /c mklink /J` is a cmd builtin that works from cmd and PowerShell but creates **nothing** when the shell between mangles those backslashes — and `npm run typecheck` then reports `'tsc' is not recognized`, so the failure arrives disguised as a broken toolchain. That happened on 2026-08-27. Prove the link exists before believing a gate.

⚠ **`2941 / 78 with one file uncollected` is CORRECT in this worktree and must not be "fixed"** — that is **F103**: `codeIndexCore.test.ts:42` reads a fixture from `_verify/6a-2/`, and `_verify/` is gitignored at `.gitignore:165` with zero tracked files. The main checkout has it and reports 2969 / 79. **Your new tests add to 2941, they do not fix the uncollected file.**

The widen-together check, and the union's new size:
```powershell
Get-ChildItem -Path src\shared\ipc.ts | Select-String -Pattern "agentKindSchema = z.enum"   # expect SIX members incl. 'shell'
Get-ChildItem -Path src\main\adapters -Recurse -Include *.ts | Select-String -Pattern "shell: shellAdapter"
```

Every `Record<AgentKind, …>` site now names Terminal — and the positive control that proves the scan ran:
```powershell
Get-ChildItem -Path src -Recurse -Include *.ts,*.vue | Select-String -Pattern "shell: 'Terminal'"
# MUST return hits. If empty, the scan is not running and any "clean" result above is worthless.
Get-ChildItem -Path src -Recurse -Include *.ts,*.vue | Select-String -Pattern "AgentKind"
```

⚠ **`Get-ChildItem … | Select-String`, NOT `Select-String … -Recurse`** — `Select-String` has no `-Recurse` parameter (it throws), and the spelling without it returns **0 silently** because `Select-String` cannot read a directory. Both were in these documents until 2026-08-27. Do not "simplify" it back.

Scope containment:
```powershell
git diff --stat        # main-process + shared + one test file. NO .vue glyph code, NO package.json.
git status --porcelain # ` M .mcp.json` still there and still unstaged
```

Remove the junction — **link only, never a recursive delete, which follows the junction and destroys the main checkout's `node_modules`**:
```powershell
(Get-Item "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" -Force).Delete()
```

**RUNTIME GATE — run the app, do not merely compile.** A real window on a `--user-data-dir` seeded from `%APPDATA%\chorus-app`, driven over CDP on **port 9333 — never 9222** (that is the stable installed instance). Launch with `npx electron-vite dev --remoteDebuggingPort 9333`. Observe and capture:
- (a) the **Terminal** card appears in the picker, **last among agents**, with its `>_` mark and **no** model / effort / permission controls;
- (b) launching it opens a working shell — run `git status` in it and read real output back;
- (c) kill it, restart it from the pane header, and confirm it comes back;
- (d) quit the app and reopen — the Terminal session **restores**;
- (e) **the refusal fires**: pick a launch profile, then click the Terminal card, then Launch — main must refuse with an authored reason rather than spawning a shell holding a credential. **⚠ If the census found zero launch profiles you must CREATE one first, or this check silently passes for the wrong reason.**

## 9. Failure honesty

If any command fails — including for an unrelated environmental reason — **capture the exact output, explain it, and do not claim the step succeeded.** A gate that did not run is not a gate that passed. Assert on the **success signal** (a count you can read), never on the absence of an error string.

## 10. Final reporting requirements

Status (`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`); files changed with line counts; build results as **actual numbers**; runtime results for each of (a)–(e) with evidence paths under `_verify/7a-2/`; **the `launch_profiles` census result as re-run at pickup**, and which form of D185's predicate shipped as a result; **which of the four `adapters.test.ts` site-kinds were edited, and the recorded decision on the two subset lists**; review outcomes; non-goals confirmation (`MIGRATIONS.length` 22, `IpcChannel` 110, `package.json` unchanged, no `.vue` glyph code touched); residual risks; final `git status --porcelain`.

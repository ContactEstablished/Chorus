# Task 3d-1 — Execution Prompt (paste into a fresh session)

*Authored 2026-07-27 against the code at `070f381`. Every fact below was re-run this session.*

---

## Role

You are the **Coordinator** for **Chorus — Task 3d-1: Provider routes that are not tied to a PTY
agent**, plus the two empirical questions that depend on it.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main`. **Confirm it; do not switch or create a branch without instruction.**
- **Expected HEAD at start:** `070f381` *("The dialogs stop looking like a different program")*.
- **Platform:** Windows 11, PowerShell primary. A Bash tool is also available; each takes its own
  syntax.

## ⚠ Read this before anything else — three pieces of context you cannot infer

### 1. This is BEHAVIOUR work, and Phase 3c is still mid-flight

**Phase 3c (Design Adoption) has 4 of 5 tasks landed and `3c-5` outstanding.** Phase 3c's purity
contract is *"this phase changes how the app looks and nothing else"*, and it has already spent
**both** of its declared behavioural exceptions (`frame:false` in 3c-2, and a session-count refresh
fix after 3c-3). **This task is behaviour, in main, and is deliberately being taken OUT OF ORDER at
Matthew's request because it blocks his actual daily use of the app.**

**Therefore:**

- **Do not touch any Phase 3c surface** — `App.vue`, `ProjectRail.vue`, `StatusBar.vue`,
  `FilmstripRenderer.vue`, `LayoutRenderer.vue`, `TerminalPane.vue`, `StateMarker.vue`,
  `TitleBar.vue`, `CommandPalette.vue`, `LaunchDialog.vue`, `EmptyState.vue`, `WorktreePanel.vue`,
  `assets/main.css`, `assets/overlays.css` — **except** where this task's own scope genuinely
  requires it (the launch dialog's provider filtering may). If you must, say so loudly and keep it
  minimal.
- **`views/SettingsProviders.vue` is 3c-5's styling target and this task's functional target.**
  That is a real collision. **Change behaviour only; leave its existing stock Tailwind classes
  alone** — 3c-5 will restyle it, and a half-restyled file is worse than an unstyled one.
- **Do not fold anything into a 3c commit, and do not claim 3c progress.**

### 2. There are uncommitted docs in the tree that are NOT yours

```
 M docs/Features/Foundation/Tasks/Phase-3c-Overview.md
 M docs/Features/Foundation/roadmap.md
?? docs/Features/Foundation/Tasks/Task-3c-4-ExecutionPrompt.md
?? docs/Features/Foundation/Investigations/
```

**Do not revert them, stage them, or commit them.** *(If Matthew committed them before you start,
HEAD will be one past `070f381` and that commit is docs-only — the ground facts are unaffected.)*

### 3. ⚠ Matthew's cost constraint, which decides what "working" means here

**He will almost never use GPT outside the subscription model, and specifically will NOT use the
api_key path for GPT, on cost grounds.** The BYOK/api-key path exists for **cheaper models of
comparable capability** — OpenRouter-routed models, and DeepSeek direct.

**So the acceptance target is: a codex-the-binary session launched against a NON-GPT model over an
OpenAI-compatible route.** A demo that proves the plumbing using GPT proves the wrong thing.

## The goal, in Matthew's words

> *"I want to be able to enumerate other models available through OpenRouter and not just for the
> purpose of Council Review. If I want to work with Deepseek-v4-Pro then I want to be able to create
> that entry in the settings and it will allow me to start an agent session and all my communication
> will flow to that model in OpenRouter. But I also have a DeepSeek account and can make calls to
> DeepSeek directly (without OpenRouter). So I need the ability to enter all the settings so that I
> can interact with these models against a directory of code."*

He also reported the symptom that started this:

> *"We need an option in the dropdown to allow for a standard API key. Right now I have Codex,
> Claude, and OpenRouter Management Key (which is not usable for agents). We need an option that just
> says 'OpenRouter API Key' and then I can fill in the rest."*

## Ground facts — all verified 2026-07-27 at `070f381`

| Fact | Where | Note |
|---|---|---|
| The provider-type dropdown renders `settings.adapters`, from `adapter:list` | `SettingsProviders.vue:553–563` | *"Everything the selects render comes from adapter:list — no hardcoded adapter names"* |
| `adapter:list` is the **agent** registry: `Object.freeze({claude, codex})`, typed `Readonly<Record<AgentKind, AgentAdapter>>` | `main/adapters/registry.ts` | so the dropdown can only ever offer launchable PTY agents |
| `agentKindSchema` is `z.enum(['claude','codex'])` | `shared/ipc.ts` | **must widen together with the registry** — see non-goals |
| "OpenRouter management key" is a **renderer-side pseudo auth method**, appended client-side | `SettingsProviders.vue:74–80` (`MANAGEMENT_METHOD`) | precedent for a synthetic entry, but see Blocker A |
| `provider_configs.adapter_type` is `TEXT NOT NULL`; the wire schema is `z.string().min(1).max(60)` | `storage.ts:132`, `shared/ipc.ts:779` | **the schema already permits a non-agent value** |
| **⚠ BLOCKER A** — council: `agentKindSchema.safeParse(provider.adapterType)`; on failure refuses *"is not configured for a known agent"* | `main/ipc.ts:2021–2024` | a non-agent provider type would be accepted by Settings and then **fail at run time** |
| **⚠ BLOCKER B** — launch: `if (provider.adapterType !== agent) return {ok:false, …'is not a ${agent} provider'}` | `main/ipc.ts:409–414` | the credential↔agent ownership check |
| ⚠ The comment directly above Blocker A says the council passes the provider's own adapter_type *"which makes resolveCredential's ownership check a **no-op HERE**"* | `main/ipc.ts:2012–2014` | **so Blocker A's gate exists only to manufacture an AgentKind for a check it then defeats by construction.** Read this carefully — it is the crux. |
| The launch dialog filters `provider.adapter_type === agent` | `LaunchDialog.vue` (`eligibleProfiles`) | a non-agent provider correctly never appears as launchable |
| Council credential picker accepts **any** non-management credential | `SettingsProviders.vue:408–413` | it already does not care about adapter_type |
| *"`adapterType`, which a council member has no business caring about"* | `main/services/councilMembers.ts:34` | the intent is already documented |
| **codex already supports an arbitrary OpenAI-compatible endpoint**, per-launch, via `-c` dotted overrides (`model_provider`, `.name`, `.base_url`, `.env_key`, `.wire_api`) + `-m` model | `main/adapters/codex.ts:105–118` | D47. `~/.codex/config.toml` is never written; the key reaches the child only via the env block |
| ⚠ codex **0.145.0 rejects `wire_api="chat"`**; only `responses` is supported | `codex.ts:98–100`, D4-verified | decisive for which routes can work — see the probe below |
| Model enumeration exists: `model:refresh(providerId, credentialId)` + a `model_catalog` table | `shared/ipc.ts:97`, `preload/index.ts:184` | enumerating OpenRouter models may already work once an OpenRouter api_key provider exists — **verify before building anything** |
| `api:probe` was **deleted** in 3b-3 | — | do not try to use it |
| Baseline: **947 tests / 29 files**, all passing | `npx vitest run` | |
| `IpcChannel` **56** · `ipcMain.handle(` **51 / 0** · `sqliteTable(` **15** · `MIGRATIONS.length` **11** | — | |
| Dev DB has **0 providers, 0 credentials, 0 launch profiles, 0 council members, 0 catalog rows** | `%APPDATA%\chorus\chorus.db` | you are starting from empty; Matthew has the keys |

## ⚠ The decision this task must settle FIRST — and it is not a dropdown

**Do not start by adding an option to a `<select>`.** The naive fix — a renderer-side pseudo
provider type mirroring `MANAGEMENT_METHOD`, with `adapter_type: 'openrouter'` — lets the user
*create* the provider and then **fails at Blocker A when a council run uses it**. A configuration
that looks valid in Settings and dies at spend time is worse than the gap it replaces.

**The real question is what `adapter_type` MEANS.** Today it carries two jobs at once:

1. **"which harness will run this"** — the launch path's ownership check (Blocker B), which is
   correct and load-bearing: a credential for a Claude provider must not launch under codex.
2. **"which service is being talked to"** — which is what Matthew is actually trying to express, and
   what the council genuinely needs, and which has **nothing to do with a PTY agent**.

**Settle this as a numbered decision (D84) before writing code**, record it in
`docs/Features/Foundation/roadmap.md`, and state the alternatives you rejected. Options worth
weighing, not a menu to pick from blindly:

- **(a) A nullable/《none》 harness.** Admit a provider whose `adapter_type` names no agent; make
  Blocker A tolerate it (its own comment says the ownership check is already a no-op there); leave
  Blocker B untouched so such a provider is simply never launchable. Smallest change; council and
  enumeration work; **does not by itself give Matthew a launchable DeepSeek route** — but the codex
  route below may already do that.
- **(b) Split the column** into "harness" and "route/service" as separate concepts. Cleanest
  semantics; costs a migration and touches every provider read.
- **(c) A provider-type registry separate from the agent registry**, with agents as one kind. Most
  general; most work.

**⚠ Whatever you choose, `agentKindSchema` and `staticRegistry` MUST NOT widen.** See non-goals.

## Then the two empirical questions — cheap, and they may shrink the task

Do these **early**, because a positive result on the first one materially changes what still needs
building.

### Probe 1 — does `codex → OpenRouter` work today?

OpenRouter now ships a **Responses API** (beta) at `https://openrouter.ai/api/v1/responses`,
described as a drop-in for OpenAI's, with reasoning and tool calling. codex only speaks
`wire_api = "responses"`. **If they meet, DeepSeek-via-OpenRouter is launchable with ZERO new
adapters and Matthew's #2 collapses into the settings work.**

Configure a provider (`adapter_type` = codex, `auth_mode` = api_key, base URL = OpenRouter, model =
a **non-GPT** model such as DeepSeek), a credential profile, then launch. **Report exactly what
happened**, including the failure mode if it fails — a clean refusal from codex is a useful result,
not a dead end.

### Probe 2 — is DeepSeek-direct chat-completions-only?

DeepSeek's own API is believed to be `/chat/completions`-shaped, **not** Responses. If so, codex
(responses-only) **cannot** host DeepSeek-direct, and that — not OpenRouter reach — is the real
argument for a second harness. **Verify against DeepSeek's current API docs; do not assert it from
memory** (`CLAUDE.md`: CLI and API surfaces move fast).

**If Probe 2 confirms the gap, the candidate harness is [OpenCode](https://github.com/sst/opencode)
— provider-neutral, MIT, and the current leader by adoption — NOT Aider**, whose distinguishing
feature (git-native, every edit a commit) is interesting for Chorus's worktree model but whose
provider neutrality is now table stakes. **Do not integrate it in this task.** Report findings and
let Matthew decide; a new adapter is Phase 3d proper and needs its own D4 verification pass.

## Implementation scope

**Expected to change:**

- `src/shared/ipc.ts` — whatever the D84 shape requires (a schema field, a sentinel, a widened type)
- `src/main/ipc.ts` — Blocker A at minimum; Blocker B only if D84 says so
- `src/renderer/src/views/SettingsProviders.vue` — **behaviour only, no restyling**
- `src/main/services/storage.ts` — only if D84 chose a migration
- Tests for whatever you change

**Also required:**

- `docs/Features/Foundation/roadmap.md` — **D84**, and a note that **Phase 3d's scope and title need
  an architect pass**: it is currently *"Two New PTY Adapters"* and now also owns provider-route
  work. Flag it; do not silently rewrite the phase.

## Strict non-goals

- **⚠ DO NOT widen `agentKindSchema` or `staticRegistry`.** The registry-freeze lift is **D34 Q5**,
  owned by **Phase 3d proper** (D52), and **D63 Q1 re-affirmed** the registry stays frozen at two
  entries. They must widen **together** or the **F25** defect returns: the `layout:get` filter
  treats `getAdapter(row.agent)` membership as proof of `agentKindSchema` validity, so an id admitted
  outside the enum passes the filter and then fails the outbound parse. **Kimi is a separate task.**
- **Do not build an api-mode session type.** D63 Q1 puts `createApiSession` outside the registry and
  Q2 keeps its handles **out of `SessionManager`** with no `sessions` row. Making API models into
  workspace panes is a different, larger piece of work — and `TerminalPane` is an xterm host.
- **Do not integrate OpenCode, Aider, or Kimi.** Report; do not build.
- **Do not restyle anything.** Phase 3c owns styling and `3c-5` is still outstanding.
- **Do not weaken Blocker B** (the launch-path ownership check) without an explicit D84 clause
  saying why — it is a real safety property, not incidental.
- **Do not let a management key become launchable or council-usable.** It is a distinct,
  higher-privilege class that mints and revokes and cannot do inference (D42/3a-3).
- **Do not push or open a PR unless explicitly asked.**

## Verification

### Build gates

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

**Expected:** typecheck **0** · vitest **947 + any tests you add**, **never fewer** ·
`grep:secrets` **clean across 6 patterns**.

### Frozen numbers — report all four

```bash
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l   # IpcChannel
grep -c "ipcMain.handle(" src/main/ipc.ts                           # 51
grep -c "ipcMain.handle(" src/main/index.ts                         # 0 — must stay
grep -c "sqliteTable(" src/main/db/schema.ts                        # 15
```

**A new channel or handler is allowed here if D84 requires it** — unlike Phase 3c, this task is not
under the purity contract. **But say so loudly and justify it**; prefer reshaping nothing.
`MIGRATIONS.length` is **11** and only moves if D84 chose option (b).

### The invariant that must not regress

```bash
grep -n "agentKindSchema = z.enum" src/shared/ipc.ts    # must still be ['claude','codex']
grep -n "staticRegistry" src/main/adapters/registry.ts  # must still be two frozen entries
```

### Runtime — the real app

**CDP on `--remote-debugging-port=9222`.** Launch with `_verify/launch.ps1` (it restores `PATH`/
`ComSpec`, which the harness strips, and returns the wrapper PID). Drivers: `_verify/3c-1-cdp.js`
(`eval`, `shot`, `media`, `mediaeval`), `_verify/3c-3-cdp.js` (`shotclip` for clipped/scaled
captures), `_verify/3c-3-hover.js` (real mouse events + capture in one session),
`_verify/3c-3-sample.ps1` (pixel sampling), `_verify/3c-2-win.ps1` (`fg`, `key`, `click` — real OS
input). `_verify/` is gitignored.

**Prove, on the running app:**

- [ ] A provider of the new shape can be **created** in Settings.
- [ ] Its models **enumerate** (`model:refresh`) — or report exactly why not.
- [ ] A **council member** can use its credential **and a run is not refused at
      `resolveMemberRoute`** — this is the specific failure Blocker A causes today.
- [ ] **The acceptance target: a codex session launched against a NON-GPT model over an
      OpenAI-compatible route, doing real work in a real directory.** Screenshot it.
- [ ] A provider with no harness **does not appear** as launchable in the launch dialog.
- [ ] A **management-key** provider is still refused for both launch and council.

⚠ **Harness facts that will bite you:**

- **F17 — electron-vite does NOT hot-restart the main process.** This task edits main; **every
  iteration costs a tree-kill and a cold boot.** `taskkill /PID <root> /T /F`.
- **`window.confirm` BLOCKS the renderer under CDP** — stub it and restore in a `finally`
  (`_verify/3c-4-expr-closenew.js` shows the pattern).
- **The DB is `C:\Users\matth\AppData\Roaming\chorus\chorus.db`.** Read it with
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <script>` (better-sqlite3 is
  built for Electron's ABI), **use forward slashes in paths** — backslash escaping through the shell
  layers presents as a misleading `SQLITE_CANTOPEN` — and stop the app first so the WAL checkpoints.
- **`window.chorus` is a frozen contextBridge object** — you cannot intercept IPC from the page.
  Prove main-side behaviour through the DB or main's log instead.

### ⚠ Cost envelope

**This task SPENDS REAL MONEY** — the first Chorus task since 3b-4 that does. The probes are a
handful of trivial prompts against cheap models.

**Envelope: `< $0.25` total.** State the measured cost against it. **Report a bound rather than a
tidy figure** if any call returns no usage frame (F39 — some routes report none at all). **Use a
non-GPT model** — that is the point of the exercise, and Matthew is explicit that he will not pay
GPT api_key rates.

## Failure honesty

**If any verification command fails for an unrelated environment reason, capture the exact output,
explain what happened, and do not claim success. A gate that could not be run is not a gate that
passed.**

**This applies hardest to the two probes.** "codex → OpenRouter works" is a claim about a real
network call against a beta API. If it fails, **say exactly how it failed** — the error text is the
most valuable thing this task can produce, because it decides whether a second harness gets built.
Do not reason from the code that it ought to work.

## Final reporting requirements

1. **Status** — `DONE` · `DONE_WITH_CONCERNS` · `NEEDS_CONTEXT` · `BLOCKED`.
2. **D84, quoted in full** — the ruling, the alternatives rejected, and why.
3. **Files changed**, with `git diff --stat`. Confirm no Phase 3c surface was restyled and that the
   uncommitted 3c docs were not folded in.
4. **The frozen numbers**, and an explicit statement that `agentKindSchema` and `staticRegistry` are
   **unchanged**.
5. **Build results** — typecheck, the vitest figure (947 + yours), `grep:secrets`.
6. **Probe 1 result** — codex → OpenRouter, with the exact command line codex was launched with
   (`-c` overrides included), and the exact output or error.
7. **Probe 2 result** — DeepSeek's actual API shape, **cited from its current docs**, not memory.
8. **The runtime checklist above, item by item**, with screenshots.
9. **Measured cost against the `< $0.25` envelope.**
10. **A recommendation on the second harness** — needed or not, and if needed, which one and why.
11. **Residual risks**, and anything you had to decide that this document did not settle.
12. **Final `git status`**, confirming the 3c docs and `Investigations/` are still untracked/uncommitted.

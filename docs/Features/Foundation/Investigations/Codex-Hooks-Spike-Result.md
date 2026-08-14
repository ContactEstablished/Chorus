# Spike result — Can `codex` report agent activity to Chorus?

_Run 2026-08-14 against `codex 0.147.0` (npm, `win32-x64`) on this machine, `main` at `5fe7a21`. Answers `Codex-Hooks-Spike.md`. Evidence under `_verify/spike-codex-hooks/`._

---

## Verdict: **VIABLE-WITH-COST**

**Codex can report to Chorus.** Everything the integration needs exists and was made to work end to end: hooks register from **argv alone** (no user file touched), they carry the same `hook_event_name` field the listener already reads, and a hook was **observed running in a real session**.

**But it costs a manual, per-machine trust approval that Chorus cannot perform on the user's behalf** — and an untrusted hook is **silently skipped**, with no prompt and no error. That failure mode is the important part: Chorus would ship a feature that simply never lights up, and nothing anywhere would say why.

Settled at **Step 3 (trust)**. Steps 1, 2 and 4 all passed.

---

## 1. What was proven, and how

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Can hooks be registered from **argv**? | **YES** | `-c "hooks.SessionStart=[{hooks=[{type='command',command='…',async=false}]}]"` → `hooks/list` reports it with `source: "sessionFlags"` |
| 2 | Does it avoid the user's `config.toml`? | **YES — completely** | `sourcePath` is a synthetic `C:\<session-flags>\config.toml`. **D49 is satisfied.** Verified by checksum: the real file is byte-identical before and after (`40791205995ca6d89524d6e3d3a2dafb`), with zero `hooks` entries. |
| 3 | Does a hook actually **run**? | **YES, when trusted** | Real authenticated `codex exec` session: `hook: SessionStart` / `hook: SessionStart Completed`, and the hook's side effect appeared on disk |
| 4 | Does an **untrusted** hook run? | **NO — silently skipped** | Identical session without the bypass flag: no marker, **no prompt, no warning, no error** |
| 5 | Can trust be granted from argv? | **NO — deliberately refused** | Same key + same hash: `trusted` when written to `config.toml`, `untrusted` when passed via `-c`. Only the channel differed. |
| 6 | Is trust tied to hook **content**? | **YES** | `currentHash` is identical for the same command from two different sources; changing the port/token in the command changes the hash (`262a4e19…` → `18461a92…`) |
| 7 | Can a **stable** command carry a per-session URL? | **YES** | A fixed command string reading `%CHORUS_HOOK_URL%` printed `http://127.0.0.1:59959/hook/deadbeef` — the env Chorus already injects at PTY launch reaches the hook process |

### The trust mechanism, exactly

Trust lives in **`config.toml`** under `hooks.state.'<key>'.trusted_hash`, where `<key>` is `<source path>:<event>:<group>:<index>` and the value is `sha256:…` over the hook's **content**. The TUI writes it via `Config/batchWrite` (the binary carries *"config/batchWrite failed while updating hook trust in TUI"*).

**This is the whole finding.** Chorus can declare a hook without touching the user's file, but it **cannot make that hook run** without either (a) the user granting trust, which writes their `config.toml`, or (b) `--dangerously-bypass-hook-trust`, whose own output warns *"Enabled hooks may run without review for this invocation."*

### The event vocabulary — **and a correction to F70**

The authoritative list is the protocol's `HookEventName` enum (from `codex app-server generate-json-schema`), **11 events**:

```
preToolUse · permissionRequest · postToolUse · preCompact · postCompact
sessionStart · sessionEnd · userPromptSubmit · subagentStart · subagentStop · stop
```

> **⚠ F70 CLAIMED `Elicitation` WAS AMONG THEM. THAT WAS WRONG AND IS CORRECTED HERE.** It was inferred from strings in the binary, where `Elicitation` occurs 239 times — but those belong to **MCP elicitation** (`McpServerElicitationRequestParams`), not to hooks. F70 also listed `PermissionDenied`, which likewise is not a hook event. **The lesson is the one F66 already taught and this spike re-taught: a string in a binary is not a feature.** The generated JSON Schema is the authority and should have been reached for first.
>
> **This does not change the verdict.** The two events that matter for `needs-you` — **`stop` and `permissionRequest`** — are both present.

Also absent, and worth knowing before anyone designs against them: **no `StopFailure`, no `Notification`, no `TeammateIdle`, no `PostToolUseFailure`, no `ElicitationResult`**. Codex's `Notification` equivalent does not exist, so **D146's `Notification → permission` mapping is Claude-only** and a codex producer would populate only `stopped` and `permission`.

Handler types are `command | prompt | agent`; the command variant carries `command`, **`commandWindows`** (a Windows-specific override — convenient for a Windows-only app), `async`, `timeoutSec` (default 600) and `statusMessage`.

### What is NOT available

**Managed hooks are not reachable from argv.** `hooks.managed_dir` / `hooks.windows_managed_dir` were set on the command line, pointed at a valid `hooks.json` and then at a deliberately malformed one; codex reported **no hooks, no warnings and no errors** in both cases. Given `HookSource` includes `mdm`, `cloudManagedConfig` and `legacyManagedConfigFile`, "managed" is evidently an enterprise-policy channel — and it *should* refuse argv, since otherwise anyone could self-certify a hook as trusted. **The auto-trusted path is closed to Chorus.**

---

## 2. The user-visible cost

If Chorus shipped this with a **stable** hook command (the only sane design — see §3):

1. **Once per machine**, the user must trust the Chorus hook: either approve it in codex's own TUI, or hand-edit `~/.codex/config.toml`. **Chorus cannot do this step**, and should not try.
2. **Again whenever the hook's command string changes** — i.e. on any Chorus upgrade that alters it. Trust is content-hashed, so the change silently invalidates it.
3. **If they never do it, nothing happens and nothing says so.** No toast, no error, no log line. Codex panes simply stay dark while claude panes light up.

**Point 3 is the one that should decide this.** A feature whose failure mode is indistinguishable from "not implemented" is worse than an absent feature, because the support burden lands on Chorus for a decision made in a config file it does not own.

---

## 3. What Chorus would have to build

Roughly, and only if this is adopted:

- **A stable hook command.** ⚠ **The obvious implementation is the broken one:** embedding the per-session URL (`http://127.0.0.1:<port>/hook/<token>`) puts a value in the command string that changes every launch, so the trust hash changes every launch and **the user is re-prompted forever**. Proven above: two URLs, two hashes. The command must be **constant** and read `CHORUS_HOOK_URL` from the environment, which was verified to reach the hook process.
- **A helper the command points at.** `curl.exe` ships with Windows 10+ and would work, but the argument list must still be byte-stable.
- **`codex.ts`** — implement the extension method and flip `hooks` from `null` to a descriptor.
- **`agentEventsCore.ts`** — map codex's event names (they are **camelCase on the wire**: `sessionStart`, not `SessionStart`) and accept that only `stopped` and `permission` are reachable.
- **Onboarding + a diagnostic.** Something must tell the user "codex hooks are configured but untrusted", because codex will not. This is arguably the largest piece of work, and it is UI, not plumbing.

---

## 4. Recommendation: **do not adopt this now**

Not because it does not work — it does — but because the cost is paid in exactly the currency Phase 4 is short of: **a silent failure mode, and a user action Chorus cannot take.**

The honest framing is that this is a **v2 feature with an onboarding story**, not a wiring task. Specifically:

- **Do not reopen Task 4-2.** A codex pane with no trusted hook has no source, and 4-2 correctly renders it as absent. That stays true and stays tested.
- **Do not ship `--dangerously-bypass-hook-trust`.** Passing a flag whose own warning says *"may run without review"* on the user's behalf is a decision in D130's class and would need a security argument that this spike does not have.
- **Revisit if** codex adds a per-application trust grant, or Chorus grows an onboarding surface where "trust the Chorus hook" is one honest step among several.

**If it is adopted anyway**, the design is fixed by the evidence and not negotiable: a **stable command string** plus `CHORUS_HOOK_URL` in the environment, and a visible diagnostic for the untrusted state.

---

## 5. New findings proposed

- **F71 — an untrusted codex hook is silently skipped.** No prompt, no error, no log. Any integration built on codex hooks fails invisibly, and the failure is identical to "not implemented". *(This is the spike's most reusable fact and outlives the decision.)*
- **F72 — codex hook trust is content-hashed, so a per-session URL in the command re-prompts forever.** The obvious implementation is the broken one; the fix is a stable command plus an env var, verified working.
- **F70 is amended** by §1 above: `Elicitation` and `PermissionDenied` are **not** codex hook events. The authoritative list is `HookEventName` from `codex app-server generate-json-schema --experimental --out <dir>`, which is the tool that should have been used first.

No decision number is proposed, because **no wiring task is being proposed.** If one ever is, D147 is next.

---

## 6. Reproducing this

Everything is under `_verify/spike-codex-hooks/` and costs nothing except the two `codex exec` runs (~8,300 tokens total):

- `probe.js` — drives `codex app-server` over stdio (`initialize` → `hooks/list`). **A token-free oracle for what codex believes is configured**, including `source`, `trustStatus` and `currentHash`. Pass `-c` overrides straight through.
- `probe-fire.js` / `probe-fire2.js` — the `thread/start` attempts. **Both are negative results and are kept as such:** `thread/start` does **not** fire `sessionStart`, so neither could distinguish trusted from untrusted. The real `codex exec` runs are what settled it.
- `schema/` — the generated protocol bundle. `codex_app_server_protocol.v2.schemas.json` holds `HookEventName`, `HookHandlerType`, `HookTrustStatus`, `HookSource` and `ConfiguredHookHandler`.
- `fakehome/` — an isolated `CODEX_HOME` used to prove the trust mechanism **without ever touching the user's `~/.codex/config.toml`**.

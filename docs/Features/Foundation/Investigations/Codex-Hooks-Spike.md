# Spike — Can `codex` report agent activity to Chorus?

_Drafted 2026-08-14 against `codex 0.147.0` (npm, `win32-x64`) and `main` at `54cc09a`. **This is an investigation, not a task.** It ships no feature and takes no commit to `src/`. Its deliverable is an answer and a decision._

> **⚠ THE QUESTION EXISTS BECAUSE A PROBE CONTRADICTED A PHASE ASSUMPTION.** Phase 4 is built on *"one producer, not four"* — only `claude` emits hook events. **F70** records that codex 0.147.0 ships a hooks subsystem whose event vocabulary and body field match Claude Code's almost exactly. That does **not** mean codex can report to Chorus; it means nobody has checked.
>
> **⚠ DO NOT WIRE A SECOND PRODUCER AS PART OF THIS SPIKE.** The deliverable is evidence and a recommendation. Wiring is a task, and it needs a decision first.

---

## 1. The question, in one sentence

**Can Chorus cause a `codex` pane to report `needs-you` — without writing the user's `~/.codex/config.toml`, and without asking the user to pass a flag whose own help text says DANGEROUS?**

Three sub-questions, in the order that kills the idea fastest if the answer is no:

1. **Argv injection** — can the hooks directory (or the hook config) be pointed at a Chorus-owned path from the command line?
2. **Delivery** — can a codex hook reach `http://127.0.0.1:<port>/hook/<token>`?
3. **Trust** — what does codex demand before it will run a hook Chorus wrote, and is that demand acceptable to ship?

**Answer them in that order and stop at the first hard no.** Each is cheap; only the third needs a real session.

---

## 2. What is already known — do not re-derive this

From F70, probed against the installed binary on 2026-08-14:

| Fact | Evidence |
|---|---|
| codex has a hooks subsystem | `codex --help` → `--dangerously-bypass-hook-trust`, *"Run enabled hooks without requiring persisted hook trust for this invocation"* |
| the body field is `hook_event_name` | **identical to what `readHookEventName` already reads** (`agentEventsCore.ts`) |
| the events include the three that matter | `Stop`, `PermissionRequest`, `Elicitation` — plus `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionDenied`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact` |
| codex-specific extras | `TurnStart`, `TurnComplete`, `TurnEnd`, `SessionConfigured` |
| config surface | `hooks.json`; `hooks.managed_dir`, `hooks.windows_managed_dir`, `hooks.command` |
| config shape | `HookHandlerConfig { state, matcher, hooks }` — the same **matcher-group** form as Claude's settings |
| trust shape | `HookStateToml { enabled, trusted_hash }` — **trust appears keyed to a content hash** |
| the engine | `codex_hooks::engine::command_runner` |

**Explicitly NOT established, and do not assume any of it:**

- **No HTTP handler type is evidenced.** The `url` / `headers` / `http_status_code` strings in the binary belong to the **network-policy and provider** subsystems, not to hooks. Assume **command handlers only** until shown otherwise.
- **Argv injection is untested.** `--strict-config` validates `config.toml` only, so it is **not** a usable accept/reject oracle for `-c` overrides. A prior attempt was inconclusive; do not repeat it and do not read its silence as a yes.
- **Event semantics are unverified.** Names in a binary are not behaviour. **F66 is in this repository because two adapter classifiers looked correct and matched nothing against real bytes.**

---

## 3. Constraints this spike may not break

- **D49 — Chorus must never write `~/.codex/config.toml`.** This is the bright line the codex adapter already expresses as a structured refusal (`configureAgent` declines permanently rather than growing a writer later). **A solution that requires editing the user's config file is a NO, not a compromise.** Writing a Chorus-owned file in a Chorus-owned directory is fine; the user's config is not Chorus's to touch.
- **D130 — the hook listener's read surface does not widen.** If codex hooks deliver a richer body than Claude's, **take `hook_event_name` and nothing else.** A second producer is not a licence to read more.
- **D45(1) — one emit path.** Nothing here taps raw PTY bytes.
- **The listener attributes by TOKEN, never by payload.** Whatever codex sends, a body claiming a `session_id` must not be trusted for attribution. This is already true and must stay true.
- **No new npm dependency.**
- **⚠ Do not modify `src/` in this spike.** Scratch files live in `_verify/spike-codex-hooks/`; the repo tree stays clean.

---

## 4. Step 1 — Argv injection (~15 min, no session, no tokens)

**Goal:** find out whether a Chorus-owned hooks location can be set from the command line.

Codex takes `-c key=value` on argv and it is already how Chorus injects settings (`CODEX_BASELINE_ARGS` carries `-c tui.status_line=…`), so the mechanism exists — the question is only whether the hooks keys honour it.

**Build a real accept/reject oracle first.** `--strict-config` will not do it. Options, in order of preference:

1. Give the key a value of the **wrong TOML type** (e.g. `-c hooks.managed_dir=123`) and see whether codex complains about the type. A type error proves the key is *parsed*, which is what you actually need to know.
2. Point `hooks.managed_dir` at a directory containing a **deliberately malformed `hooks.json`** and look for the parse error the binary already carries strings for: *"failed to parse hooks config"* / *"failed to read hooks co…"*. **An error message naming your file is proof the path was honoured** — a much stronger signal than silence.
3. If codex exposes any hooks listing (the binary carries `HooksListResponse` / `HooksListEntry`), use it to enumerate what codex believes is configured. Check `codex --help`, `codex debug --help`, and the app-server surface for a listing command before hand-rolling anything.

**Record:** the exact command, the exact output, and which of `hooks.managed_dir` / `hooks.windows_managed_dir` Windows actually consults. **On Windows, expect the `windows_managed_dir` key to be the live one and say so explicitly.**

> **If no argv path exists → the spike is very likely over.** Say so plainly, record it against D49, and stop. Do not propose writing the user's config file as a fallback.

---

## 5. Step 2 — Delivery (~20 min, still no tokens)

**Goal:** get any codex hook to execute a command Chorus controls.

Write a minimal `hooks.json` into the Chorus-owned directory from Step 1, with **one** matcher on a cheap, early, unambiguous event — `SessionStart` is ideal because it fires immediately and Chorus's own classifier deliberately ignores it, so a mistake here cannot light a false amber.

The handler should be the smallest possible observable side effect: **append a line to a file.** Do not start with an HTTP POST — if it fails you will not know whether the hook did not fire or the POST did not land.

**Then, and only then**, switch the handler to a POST at `http://127.0.0.1:<port>/hook/<token>` and confirm it arrives. Get the port and a token by launching a Chorus dev instance (`_verify/4-1/launch-4-1.ps1`, throwaway `--user-data-dir`) and reading the bound port from the app log line `[agent-events] hook listener bound on 127.0.0.1`. **Mint the token via a real `register()`** — do not fabricate one; the 404 shape is deliberately identical for every rejection and will tell you nothing.

**Windows note:** the handler runs through `codex_hooks::engine::command_runner`. Whatever posts must exist on a stock Windows box — `curl.exe` ships with Windows 10+ and is what Claude's own hook command uses. **Check what `claude`'s injected hook command actually looks like and copy its shape**; there is no reason to invent a second idiom.

**Record:** the `hooks.json` verbatim, whether the file-append fired, whether the POST arrived, and the **exact body codex sent** — pretty-printed, with any content-bearing fields redacted before it goes in the report.

---

## 6. Step 3 — Trust, and what it costs the user (~30 min, one real session)

**This is the step that decides whether the idea is shippable, and it is the one most likely to kill it.**

`HookStateToml { enabled, trusted_hash }` suggests codex trusts a hook **by content hash**, persisted. The binary also carries *"failed to write hook trust"*, *"skipping materialized plugin hook trust after account changed"*, and a TUI path (`tui/src/hooks_rpc.rs`) — which together suggest **trust is granted interactively and can be invalidated by events outside Chorus's control.**

Answer these, by observation:

1. **On first launch with a Chorus-written hook, what does the user see?** A prompt? A silent skip? An error? **Photograph it.**
2. **Is trust persisted per hash?** Change one byte of the hook command and relaunch. If trust is revoked, then **every Chorus upgrade that changes the hook command re-prompts every user** — that is a serious shipping cost and must be written down.
3. **Does the account-change invalidation fire in ordinary use?** The string suggests logging in or switching accounts drops trust.
4. **What exactly does `--dangerously-bypass-hook-trust` skip?** Understand it well enough to explain why Chorus does or does not use it. **The default assumption is that Chorus does NOT ship it** — a flag whose own help says DANGEROUS, passed silently on the user's behalf, is a decision that needs a security argument in the same class as D130's.

> **⚠ A "yes, but every user must approve a prompt they do not understand, and again after each upgrade" is a NO for the default path.** It might still be a supported opt-in. Report it as what it is; do not round it up.

---

## 7. Step 4 — Semantics (~20 min, same session)

Only if Steps 1–3 pass. Subscribe to the full set and drive one real codex turn:

- a prompt that requires **approval** (codex's sandbox makes this easy — ask for a command outside the workspace),
- then let the turn **complete**.

**Confirm which events actually arrive, in what order, and with what timing.** Specifically:

- Does `Stop` fire at end of turn the way Claude's does — or does codex use `TurnComplete` / `TurnEnd` for that, leaving `Stop` to mean something else? **This is the single most important semantic question**, because `Stop` is the load-bearing event for amber.
- Does `PermissionRequest` fire on the approval prompt?
- Do the codex-specific events (`TurnStart`, `TurnComplete`, `SessionConfigured`) overlap or conflict with the existing classification?

**⚠ If codex's `Stop` does not mean "the turn ended and a human is needed", the classifier cannot be shared as-is** — and that is a finding worth the whole spike, because it is exactly the assumption a naive implementation would make from the matching name.

---

## 8. What to produce

A short report — **in `Investigations/`, not the roadmap** — answering:

1. **Verdict:** `VIABLE` / `VIABLE-WITH-COST` / `NOT VIABLE` / `INCONCLUSIVE`, and at which step it was settled.
2. **Evidence** for each of Steps 1–4: exact commands, exact outputs, the `hooks.json` used, the body codex sent (redacted), screenshots for anything interactive.
3. **The user-visible cost**, stated plainly: what a codex user would have to see, click, or re-approve — including after an upgrade.
4. **The D49 answer:** was a Chorus-owned path reachable from argv, yes or no.
5. **What Chorus would have to build**, in files and rough size, if this were adopted.
6. **A recommendation, including the option of not doing it.** *"Codex can report, and it is not worth what it costs"* is a perfectly good outcome and must be available as one.
7. **New findings** — the next free number is **F71** (F70 is this spike's premise). **A decision number is only needed if a wiring task is actually proposed**, in which case the next free is **D147**.

---

## 9. What this spike must NOT conclude

- **Not** that Phase 4 was wrong. *"One producer, not four"* is correct for the code as it stands, and Overview §5 already said widening is *"a decision, not a matcher change"*.
- **Not** that Task 4-2 should be reopened. The Inbox's "three-state agents are absent" assertion is correct today and stays tested. **If codex ever becomes a producer, codex panes gain rows because they gained a source — which is the design working, not a bug.**
- **Not** that `hooks: null` in `codex.ts` was dishonest. It declares what Chorus implements, and `codex.ts:78` already named the hook-trust flag it was not acting on. **If this spike succeeds, the capability descriptor changes because the capability was BUILT — not because the old value was a lie.**
- **Not** that `opencode` follows. It is a separate mechanism (`plugin`, `serve`, `attach`, ACP) and a separate spike. **Do not generalise from codex to it.**

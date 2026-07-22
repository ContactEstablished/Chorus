# Council Brief CR-3.0 — Credential Vault Security for Chorus

_Issued 2026-07-21 · Status: AWAITING FINDINGS · Decision owner: Matthew Wilson · Recorder: Claude (roadmap §6, to be filed as **D33**)_

You are a review council of independent LLM models. Deliberate on the decision below and return findings in the **Required Output Format** at the end. You have no other context on this project — everything you need is in this document. Where you are uncertain about an external fact (an OS API's exact guarantee, a CLI's env-var name), **say so explicitly rather than guessing**; the implementer re-verifies every such fact against the tool's own documentation before coding.

---

## 1. What Chorus is

Chorus is a local-first Windows desktop app (Electron 43 + Vue 3 + TypeScript + Vite + Pinia) for running multiple AI coding agents in parallel terminal panes. Each pane hosts an xterm.js terminal attached over typed IPC to a PTY session (node-pty/ConPTY) owned by the Electron **main** process. The agents are real interactive CLI TUIs — today Claude Code (`claude.exe` 2.1.215) and Codex CLI (`codex` 0.144.6, an npm `.cmd` shim spawned through `cmd.exe /c`). The renderer is strictly a view layer and never spawns processes.

Locked rules (not up for review): sessions live in main, owned by `SessionManager`; all Zod validation in main only (the renderer's CSP forbids `eval`, which Zod's compiled parsers need); the preload is a narrow, Zod-free typed forwarder over `contextBridge` with `contextIsolation: true` and `nodeIntegration: false`; IPC payloads are plain objects; persistence is SQLite (better-sqlite3 + Drizzle typed queries) with hand-rolled versioned migrations; **local-first — nothing leaves the machine except calls the user's own agents make to their own providers**.

## 2. Why Phase 3 exists

Through Phase 2, every agent launched on the developer's *ambient* environment: `pty.spawn(file, args, { env: process.env })` — the app's whole environment block, inherited untouched. Whatever keys happened to be in the developer's shell were what the agent used. There was no vault, no credential record, and no injection.

Phase 3 introduces **BYOK** (bring your own key): the user stores API credentials in Chorus, and Chorus injects the right one into the right agent process at launch. This is the phase's stated milestone — *"agents launch with injected BYOK credentials, keys never touching args/logs/transcripts."* The motivating real-world need is **billing separation**: the same developer holds several keys for the same provider (employer, contract client, personal) and must be certain which one a given agent session is spending.

This council is the phase's **pre-identified security checkpoint**. Everything downstream — the settings UI, the launch flow, the adapter's `buildLaunch`, and Phase 3b's council-member configuration — is built on whatever contract you produce here.

## 3. Current implementation state (verified 2026-07-21, commit `04a8a0d`)

- **No credential handling exists anywhere.** `grep -rn safeStorage src/` returns nothing. There is no vault, no `credential_profiles` table, no provider record, no key input.
- **Persistence:** SQLite at `%APPDATA%\chorus\chorus.db` (WAL mode). Four migrations applied. Tables: `projects`, `pane_layouts`, `settings` (key/value), `sessions`, `worktrees`, `schema_migrations`. Foreign keys are **enforced** (the driver defaults `PRAGMA foreign_keys=ON`). The migration engine is a hand-rolled numbered array applied inside a transaction; the developer's existing database must upgrade **in place, with zero data loss**.
- **The session ring buffer.** Every PTY session keeps its recent output in memory — a ~4,000,000-character ring buffer — and **replays it to the renderer on every attach**, so a reloaded window or a re-mounted pane repaints its screen. Terminal output is otherwise not persisted to disk today (on-disk transcripts are a later phase, and are explicitly in scope for your redaction answer because the buffer is their future source).
- **Logging** is 24 raw `console.*` calls across six main-process files (boot, storage, restore, worktrees, IPC). A structured logger with a redacting serializer (`pino`) is being introduced in the task immediately *before* the vault, specifically so that redaction exists before any secret does.
- **Process launch:** `resolveCli(name)` locates the executable via `where.exe`, preferring a real `.exe` and falling back to `cmd.exe /c <shim>` for npm shims. The resolved file and args go straight into `pty.spawn`. **Args are currently only the shim path — no user-controlled arguments are passed today.**
- **The agents authenticate themselves today.** Claude Code uses its own subscription login (an expired one, on this machine); Codex uses ChatGPT sign-in or `OPENAI_API_KEY`. So "no credential" is a legitimate, common, *default* case that must keep working — the vault is additive, never mandatory.

## 4. Platform facts the options rest on

(Stated for shared context. Where a guarantee matters to your answer, say how confident you are; the implementer verifies before coding.)

- **Electron `safeStorage`** (available in Electron 43, confirmed in the installed typings) exposes `isEncryptionAvailable(): boolean`, `encryptString(plainText): Buffer`, `decryptString(encrypted: Buffer): string`, plus async variants and a `decryptStringAsync` that reports `shouldReEncrypt` when the underlying key has rotated. On Windows it is backed by **DPAPI**, and `isEncryptionAvailable()` returns true once the app has emitted `ready`.
- **DPAPI's protection scope is the Windows user account**, not the application. Any process running as the same user can call `CryptUnprotectData` on the same blob. So `safeStorage` defends against: another user on the machine, a stolen database file, a backup, a synced folder, casual inspection. It does **not** defend against: malware already running as this user, or another app on the machine that reads Chorus's database file and calls DPAPI itself. Confirm or correct this characterization — the honesty of the threat model depends on it.
- **Windows process command lines are readable by any process the user can query** (`Get-CimInstance Win32_Process | select CommandLine`, Process Explorer, and similar). This is the specific reason keys must never be CLI arguments.
- **A child process's environment block is also readable**, though less casually (it requires reading the target process's memory — Process Explorer does this routinely, and any process running as the same user can). Env-var injection is therefore **better than arguments, not airtight**, and any contract claiming "keys never leave the vault" must state honestly what env injection does and does not buy.
- **The agent itself receives the key by design.** A CLI agent given `ANTHROPIC_API_KEY` can print it, write it to a file, or send it anywhere — it is an autonomous program with shell access. Chorus's guarantee can only ever be about *Chorus's own* surfaces.

## 5. The decision

**What is the credential vault's security contract — storage shape, decryption lifetime, injection surface, failure modes, and redaction coverage — such that a key never becomes observable through any surface Chorus itself controls?**

This shapes migration v5 (`provider_configs`, `credential_profiles`), the `CredentialVault` service, the credential IPC channels, and the launch-time injection path.

### Q1 — Storage shape: what is encrypted, and what stays in the clear?

The target data model sketches `credential_profiles (id, provider_id, label, encrypted_blob, created_at, last_verified_at)`.

- **Option A — narrow blob:** encrypt only the secret string; provider id, label, creation time, and verification time stay plaintext columns. Simple, queryable, minimal decrypt surface. Weakness: metadata (which providers a user holds keys for, how many, their labels — potentially client names) is readable from a stolen DB file.
- **Option B — envelope blob:** encrypt a JSON envelope (`{key, baseUrl, extraHeaders, …}`) so auth material that is *not* strictly the key — proxy URLs, org ids, custom headers — is also protected and the schema does not churn as auth modes grow (PLAN keeps `cli-managed | api-key | oauth | azure-identity | aws-profile | local-endpoint` open). Weakness: every read decrypts a whole envelope; more plaintext lives in memory per operation.
- **Option C — envelope blob + encrypted metadata:** as B, but labels are encrypted too. Weakness: the settings list cannot render without decrypting every profile at page load — an enormous widening of decrypt frequency for modest gain.

State also: **does anything derived from the key stay in the clear** — a masked hint (`sk-ant-…4f2a`) or a fingerprint hash — so the user can tell two keys apart in the UI without decrypting? If yes, specify exactly what may be stored, because a poorly chosen hint is a partial key disclosure.

### Q2 — Decryption lifetime and the injection surface

At launch, main must turn a stored blob into an env var on a child process.

- **Option A — decrypt per launch, never retain:** decrypt immediately before `pty.spawn`, build the child's env, drop the reference. Every launch pays a DPAPI call (sub-millisecond). Nothing decrypted survives in main's heap by design.
- **Option B — decrypt on demand and cache for the app session:** an in-memory map of decrypted keys, cleared on quit. Fewer DPAPI calls; a long-lived plaintext key in the main process's heap, reachable by a heap dump or a crash minidump.
- **Option C — decrypt per launch, and additionally isolate:** as A, plus deliberate hygiene — the plaintext never enters a variable that outlives the spawn call, never becomes a property of a retained object, and is never passed through any function that logs its arguments.

Answer also, concretely:
1. **Is `env: process.env` still inherited wholesale, with the key added?** Or should the child receive a **constructed allow-list** environment (PATH, SystemRoot, TEMP, the agent's own vars, plus the injected key) so an unrelated ambient key in the developer's shell is *not* silently handed to the agent? The second is stricter and matches billing-separation intent, but risks breaking CLIs that need environment the allow-list forgot.
2. **What crosses IPC?** The renderer must create and select credentials but must never receive one. Is the credential API strictly **write-only inbound** (`create` takes a plaintext key; nothing ever returns one)? What does "delete" and "replace" look like under that rule?
3. **Should the launch payload carry a `credential_profile_id`** (renderer names a profile, main resolves and decrypts), and how is that id authorized — can any renderer message launch an agent with any profile, and does that matter given the renderer is trusted-but-sandboxed?

### Q3 — Failure modes: what happens when decryption cannot succeed?

`safeStorage` can fail in ways that are ordinary, not exotic: `isEncryptionAvailable()` false; a blob that no longer decrypts (Windows profile change, machine migration, restored backup, a DPAPI key rotation); `decryptStringAsync` reporting `shouldReEncrypt`; a corrupt or truncated blob from a partial write.

For each, specify the behavior: refuse to store at all, store plaintext with a loud warning (**presumed unacceptable — say so if you disagree**), mark the profile "unavailable" and keep the row, or delete the row. Answer especially:
- **Does a failed decrypt fall back to launching without the key** (agent silently uses subscription auth or fails at the provider), or does the launch **refuse** with an explicit error? The first is friendlier and the second is honest; billing separation argues hard for the second.
- **Is a plaintext fallback ever acceptable** — e.g. on a platform where `safeStorage` is unavailable? Chorus is Windows-only in v1, where it should always be available, so this may be a pure refusal case.
- **What must never appear in the resulting error message or log line?**

### Q4 — Redaction coverage: which surfaces must be scrubbed, and how?

A structured logger with a redacting serializer lands immediately before the vault. Define what it must cover. At minimum consider: log objects (declared redact paths), free-text log messages (regex scrub on known key shapes), thrown `Error` messages and stack traces, IPC payloads if ever logged, and crash reports.

Then the harder one, which the coordinator considers the **most under-appreciated surface in this phase**:

> **The PTY output stream.** Chorus keeps ~4 MB of each session's terminal output in a ring buffer and replays it to the renderer on every attach. An agent can trivially print its own key — `echo $env:ANTHROPIC_API_KEY`, a debug flag, a crash dump, a `printenv`, or an error page from the provider that echoes the credential. Once printed, the key sits in the buffer, is replayed to the renderer on attach, and would be written verbatim into the on-disk transcripts a later phase adds.

Rule on this explicitly:
- Should Chorus **scrub the PTY stream** for known key shapes (and/or for the exact key values it injected into that specific session, which it knows)?
- If yes, where — on ingest into the ring buffer, on replay to the renderer, or only at transcript-write time in a later phase? Note the tension: scrubbing on ingest is the only option that keeps plaintext out of main's memory, but it mutates what the user sees in their terminal, and a naive scrubber can corrupt legitimate output or break ANSI sequences mid-escape when a match straddles two chunks.
- If no, say plainly that this is an accepted, documented limit of the guarantee — an honest limit is better than an overclaimed one.

### Q5 — The claim itself

Chorus will tell users their keys are safe. **Write the guarantee that is actually true** — one short paragraph, no marketing — naming what is protected, against whom, and what is explicitly *not* protected (an agent that leaks its own key; malware running as the same user; a determined local process reading the child's environment block). If any option above cannot support an honest version of this claim, say which and why.

### Q6 — Option-fixation check

Is there a failure mode in any of the above that should force a different shape entirely? Named candidates, only if load-bearing: a per-launch **credential broker** where the agent never receives the raw key (a local proxy holds it and the agent gets a loopback base URL plus a session token — PLAN already contemplates LiteLLM-style `ANTHROPIC_BASE_URL` proxying); an **OS-credential-manager** backing instead of DPAPI blobs in SQLite; or **no storage at all** (prompt per launch, hold nothing). Name one only if you would actually argue for it — this is a check against option fixation, not an invitation to bikeshed.

## 6. Constraints the winner must survive

1. **The exfiltration rule (prime directive of this CR):** no key may become observable through a surface Chorus controls — command lines, log files, transcripts, IPC responses, renderer state, error messages, or crash artifacts. Surfaces Chorus does *not* control must be named honestly rather than papered over.
2. **The no-credential path stays first-class.** Both current agents authenticate themselves via subscription login. A user who never opens the credential UI must see exactly today's behavior, with no new prompts, warnings, or degradation.
3. **Renderer never sees plaintext.** The renderer is a Chromium page with devtools; treat anything reachable from it as public. The credential API is write-only inbound unless you argue otherwise and defend it.
4. **Migration cost:** the developer's existing database (6 tables, 4 migrations, live project/session/worktree rows) upgrades in place with zero manual steps and zero data loss. The schema should not need re-migration when Phase 3a adds `model_catalog`, `launch_profiles`, and `usage_records`, or when Phase 3b adds council members (each of which is a credential profile plus a base URL and a model id).
5. **Verifiability under G2.** Every claim in the contract must be provable by driving the real app — inspecting the DB blob, the live process's command line and environment, the log output, and the IPC surface — **without ever exposing a real key**. Verification uses planted fake keys of realistic shape. If a clause cannot be verified that way, say so.
6. **Bounded implementation.** This is one task in a five-task phase, not a security platform. Prefer contracts an implementer can code and a reviewer can check in a single session.
7. **Windows-only v1.** macOS/Linux `safeStorage` backends (Keychain, libsecret/kwallet, and the `basic_text` fallback that is **not** real encryption) are out of scope, but the contract should not paint the design into a corner if the app is ever ported.

## 7. Evaluation rubric (weigh in this order)

1. **Exfiltration resistance** — a key stays unobservable across every Chorus-controlled surface, including the ones nobody thinks about (35%).
2. **Honesty of the guarantee** — the claim made to users matches what the design actually delivers; limits are named, not hidden (25%).
3. **Failure-mode correctness** — unavailable encryption, undecryptable blobs, and corrupt rows all resolve to a defined, safe state (15%).
4. **Contract simplicity & UX** — the no-credential default is untouched; a user can predict which key a session spends (15%).
5. **Forward compatibility** — Phase 3a profiles/catalog, Phase 3b council members, future api-mode adapters and proxy/base-URL routing (10%).

## 8. Questions for the council

1. Q1: storage shape (A/B/C or a named hybrid), plus the exact rule on masked hints/fingerprints, and the **strongest argument against** your choice.
2. Q2: decryption lifetime, plus committed answers on env inheritance vs allow-list, the write-only IPC rule, and how a launch names a credential.
3. Q3: the behavior for each failure mode, and specifically whether a failed decrypt refuses the launch or degrades to no-key.
4. Q4: the redaction coverage list, **and a ruling on the PTY-stream question** — scrub (where) or accept-and-document.
5. Q5: the honest guarantee paragraph, verbatim.
6. Q6 as posed: load-bearing alternative shapes only.

## 9. Success criteria for this council session

The council **succeeds** if it returns: (a) one committed answer per question Q1–Q5, or an explicit tie with the tie-breaker named; (b) the vault security contract restated as 5–9 sentences an implementer can code from verbatim; (c) an enumerated risk list with mitigations; (d) explicit dissents preserved — do not average away disagreement. The council **fails** if it returns a survey without commitment, if it achieves unanimity by dropping the rubric, or if it produces a guarantee paragraph that overclaims.

## 10. Required output format

```
## Per-model positions
<model>: Q1 <choice> / Q2 <one-line rule> / Q3 <one-line rule> / Q4 <scrub|accept + where> — <2-4 sentence rationale> — Strongest counterargument: <1-2 sentences>

## Council synthesis
Q1: <A|B|C|hybrid(named)> + hint/fingerprint rule (<unanimous | majority N-of-M>)
Q2: <lifetime + env policy + IPC rule + launch naming, 2-5 sentences> (<vote>)
Q3: <per-failure-mode behavior + refuse-vs-degrade ruling, 2-4 sentences> (<vote>)
Q4: <redaction coverage + PTY-stream ruling, 2-5 sentences> (<vote>)
Dissents: <model: position and unresolved reason, or "none">

## The vault security contract (verbatim, implementable)
<5-9 sentences>

## The honest guarantee (user-facing, verbatim)
<one short paragraph>

## Risks & mitigations for the winner
1. <risk> → <mitigation>
...

## Answer to question 6
<concise; "none load-bearing" is acceptable>

## Action items for implementation
<numbered, imperative, each verifiable>
```

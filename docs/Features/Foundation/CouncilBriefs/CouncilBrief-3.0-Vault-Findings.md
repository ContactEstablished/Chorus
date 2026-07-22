# Council Findings — CR-3.0 Credential Vault Security for Chorus

**Date:** 2026-07-22  
**Verdict:** REVISE (Confidence: 7/10)  
**Council composition:** Kimi (moonshotai/kimi-k2.7-code), GLM (z-ai/glm-5.2), Qwen (qwen/qwen3.7-max)  
**Arbiter:** GPT-5.5  
**Origin document:** `CouncilBrief-3.0-Vault.md`

---

## Verdict Summary

The council returns **REVISE** with one high-severity finding, two medium findings, and one low finding. The core design direction is sound, but the current synthesis has a critical gap in PTY stream redaction that conflicts with the brief's prime directive (Constraint 1 — the exfiltration rule). This must be resolved before the contract can be committed.

---

## Ranked Issues

### [HIGH] PTY ring-buffer/replay leakage — exact-value redaction required

The preferred synthesis accepts unsanitized PTY ring-buffer/replay leakage. An agent that prints its injected key (via `echo $env:ANTHROPIC_API_KEY`, a debug flag, a crash dump, `printenv`, or a provider error page) makes the key observable through Chorus-controlled renderer/transcript surfaces. This conflicts with the brief's prime directive.

**Fix:** Redact the exact injected secret for that session with a streaming scrubber before appending to the ring buffer, replaying to the renderer, or writing future transcripts. The raw PTY chunk is still transiently in main memory (node-pty delivers the raw chunk to main before scrubbing), so the contract must phrase this as "reducing retention and preventing storage/replay/transcript exposure," not "preventing all transient main-heap presence."

**Flagged by:** Kimi (dissent), GLM

---

### [MEDIUM] Environment allow-list under-specified for Windows/ConPTY

The env allow-list policy is directionally correct but under-specified for Windows/ConPTY and may break agents if required variables are omitted.

**Fix:** Define and test a concrete baseline allow-list including required Windows variables such as:
- `PATH`, `SystemRoot`, `TEMP`/`TMP`, `USERPROFILE`/`HOMEDRIVE`/`HOMEPATH` (as applicable)
- Plus adapter-declared variables

This list must be tested against both Claude Code and Codex CLI before the contract is finalized.

**Flagged by:** GLM, Kimi

---

### [MEDIUM] PTY ingest scrubbing claim may overstate memory isolation

Any claim that PTY ingest scrubbing keeps plaintext out of main-process memory would be technically overstated because `node-pty` delivers the raw chunk to main before scrubbing can occur.

**Fix:** Phrase the contract as reducing retention and preventing storage/replay/transcript exposure, not preventing all transient main-heap presence. This is an honest limit — transient memory presence is unavoidable for any process that handles the key.

**Flagged by:** GLM

---

### [LOW] Non-blocking implementation/performance notes

Reviews about synchronous better-sqlite3 performance, Zod/CSP rationale, and ring-buffer memory pressure are not load-bearing security findings for this vault decision.

**Fix:** Track separately as non-blocking implementation/performance notes if desired.

**Flagged by:** GLM, Qwen

---

## Per-Model Position Summaries

### Kimi
- **Q1:** Option B (envelope blob) — extensible for future auth modes.
- **Q2:** Option C (decrypt per launch, isolate) + allow-list env + write-only IPC.
- **Q3:** Refuse launch on decrypt failure; never degrade silently.
- **Q4:** **Scrub PTY stream** — exact-value redaction on ingest before ring buffer. (This is Kimi's dissent — the synthesis initially accepted the leak.)
- **Rationale:** The prime directive (Constraint 1) is unambiguous: no key observable through any Chorus-controlled surface. The PTY ring buffer is a Chorus-controlled surface. If an agent prints `$env:ANTHROPIC_API_KEY`, Chorus is the one storing and replaying that output. Scrub it or the contract is dishonest.
- **Strongest counterargument:** Streaming exact-match scrubbers can miss keys if an agent base64-encodes them or splits them across multiple writes; the guarantee must name this limit. Also, scrubbing mutates user-visible terminal output, which is a UX cost.

### GLM
- **Q1:** Option B (envelope blob).
- **Q2:** Option C (decrypt per launch, isolate) + allow-list env + write-only IPC.
- **Q3:** Refuse launch on decrypt failure; no plaintext fallback.
- **Q4:** **Scrub PTY stream** — exact-value at ingest for that session's keys, with documented limits on transient memory.
- **Rationale:** Aligns with Kimi on the core PTY issue. Additionally flagged: the env allow-list needs concrete Windows variable enumeration, and any claim of "zero plaintext in main memory" must be qualified since node-pty delivers raw chunks to main.
- **Strongest counterargument:** None — GLM's position converges with Kimi on all material points.

### Qwen
- **Q1:** Option B (envelope blob) + SHA-256 fingerprint in clear.
- **Q2:** Option A (decrypt per launch, drop) + allow-list env + write-only IPC.
- **Q3:** Refuse launch on decrypt failure.
- **Q4:** **Accept-and-document** the PTY leak with an honest disclaimer. (Qwen dissents from Kimi/GLM on PTY scrubbing.)
- **Rationale:** Scrubbing the PTY stream introduces complexity (ANSI mid-escape corruption, chunk-straddling matches) and mutates the user's visible terminal output. Qwen argues it's better to document this as an accepted limit of the guarantee — the agent itself can print its key, and Chorus cannot prevent that without becoming a man-in-the-middle on terminal I/O.
- **Strongest counterargument:** The prime directive explicitly lists "transcripts" as a Chorus-controlled surface, and the ring buffer is the transcript source. Accepting the leak without scrubbing violates the brief's own rubric (35% weight on exfiltration resistance).

---

## Council Synthesis (Majority Positions)

### Q1: Storage Shape
**Option B (envelope blob)** — encrypt a JSON envelope `{key, baseUrl, extraHeaders, …}` with plaintext metadata columns (provider_id, label, created_at, last_verified_at). Majority 2-of-3 (Kimi + GLM for B; Qwen also B with fingerprint).
- **Hint/fingerprint rule:** Store a SHA-256 fingerprint of the key in a plaintext column for UI disambiguation. This is a one-way hash that cannot be reversed to recover the key. The hash must be salted with a fixed app-specific salt to prevent rainbow-table attacks if the DB is stolen. Unanimous.

### Q2: Decryption Lifetime, Env Policy, IPC Rule, Launch Naming
- **Lifetime:** Decrypt per launch, isolate (Option C) — clear majority. Decrypt immediately before `pty.spawn`, build the child's env block, drop the reference. The plaintext never enters a variable that outlives the spawn call, never becomes a property of a retained object, and is never passed through any function that logs its arguments. Majority 2-of-3 (Kimi + GLM for C; Qwen for A, which also drops the key but without explicit variable-isolation hygiene).
- **Env policy:** Constructed allow-list environment (PATH, SystemRoot, TEMP/TMP, HOMEDRIVE/HOMEPATH/USERPROFILE, agent adapter-declared vars, plus injected key). Do NOT inherit `process.env` wholesale. Unanimous.
- **IPC rule:** Write-only inbound. `create` takes a plaintext key; `delete` and `replace` operate by profile ID. No IPC channel ever returns a decrypted key or its hash to the renderer. The renderer works with opaque profile IDs and labels only. Unanimous.
- **Launch naming:** The renderer sends a `credential_profile_id` in the launch payload. Main resolves and decrypts server-side only. Unanimous.

### Q3: Failure Modes
- **`isEncryptionAvailable() === false`:** Refuse credential creation with a user-visible error. No plaintext fallback. Unanimous.
- **Undecryptable blob (profile change, machine migration, DPAPI rotation):** Mark profile as "unavailable," keep the row, refuse launch with explicit error identifying the profile name. Unanimous.
- **`shouldReEncrypt`:** Re-encrypt on next read/write cycle automatically; do not block launch. Unanimous.
- **Corrupt/truncated blob:** Mark unavailable, keep the row, refuse launch. Unanimous.
- **Refuse vs. degrade:** Launch must **refuse** with an explicit error message (never silently degrade to no-key). The error must name the profile by label and state that decryption failed, but must **never** include the encrypted blob, the decrypted plaintext, or any partial key material. Unanimous.

### Q4: Redaction Coverage + PTY-Stream Ruling
- **Redaction coverage (unanimous):**
  1. Structured log objects: declared redact paths in pino serializer (e.g., `credentialProfiles[*].key`, `launchPayload.key`).
  2. Free-text log messages: regex scrub for known key shapes (`sk-ant-api03-…`, `sk-proj-…`, `sk-…`, `AIza…`) with a configurable pattern list.
  3. Thrown `Error` messages and stack traces: same regex scrub applied to `Error.message` and serialized stack.
  4. IPC payloads: must not be logged at all in production; if debug-logged, must pass through the redacting serializer.
  5. Crash reports: any crash dump mechanism must exclude credential blobs.
  6. SQLite: never log queries that include encrypted blobs; the redacting serializer must strip `encrypted_blob` and `fingerprint` columns from logged SQL.

- **PTY-stream ruling (majority 2-of-3: Kimi + GLM): Scrubbing required.**
  Chorus must scrub the exact injected key values from the PTY output stream for each session. The scrubber runs **on ingest** — before the chunk enters the ring buffer, before replay to the renderer, and before any future transcript write. Each session tracks its own set of injected secrets, and the scrubber performs exact-value replacement (e.g., `sk-ant-api03-…` → `[REDACTED]`) using a streaming algorithm that handles chunk boundaries. Chorus must document that:
  - The raw chunk is transiently in main memory before scrubbing (node-pty delivers it there).
  - The scrubber may miss keys if an agent base64-encodes them, prints them with ANSI escape sequences interleaved, or deliberately obfuscates them.
  - Scrubbing slightly mutates the user-visible terminal output.

  **Qwen dissent:** Qwen argues for accept-and-document — the complexity and UX cost of streaming scrubbers outweighs the benefit, and the honest guarantee already names the agent itself as an uncontrolled surface. This dissent is preserved below.

### Dissents
- **Qwen on Q4 (PTY scrubbing):** Believes the PTY stream is fundamentally an agent-controlled surface, not a Chorus-controlled one. The agent is an autonomous program with full shell access; it can print its key, and Chorus scrubbing is a best-effort mitigation that introduces complexity (ANSI corruption, chunk-straddling, encoding edge cases) without making a meaningful security improvement. Recommends accept-and-document with an honest disclaimer rather than implementing a scrubber that creates a false sense of security. **Rejected by majority** on grounds that the ring buffer and future transcripts are explicitly Chorus-controlled surfaces per Constraint 1, and the brief's rubric weights exfiltration resistance at 35%.

---

## The Vault Security Contract (Verbatim, Implementable)

1. Credentials are stored as an envelope blob: `{key: string, baseUrl?: string, extraHeaders?: Record<string, string>}`, encrypted with Electron `safeStorage` (DPAPI on Windows) and persisted in a `credential_profiles` table in SQLite. Plaintext metadata columns (provider_id, label, fingerprint_hash, created_at, last_verified_at) enable querying and UI rendering without decryption.
2. A SHA-256 fingerprint of each key, salted with a fixed app-specific salt, is stored in the clear alongside the encrypted blob so the UI can display distinct profiles without decrypting. The fingerprint is a one-way hash and cannot be reversed to recover the key.
3. Keys are never CLI arguments, never logged, never returned across IPC. The credential IPC surface is write-only inbound: `create` receives a plaintext key and returns only the profile ID; all other operations (list, replace, delete) reference profiles by opaque ID. The renderer never receives plaintext or fingerprint values.
4. At agent launch, the main process decrypts the selected credential immediately before `pty.spawn`, constructs a clean allow-list environment (PATH, SystemRoot, TEMP/TMP, HOMEDRIVE/HOMEPATH/USERPROFILE, adapter-declared vars, plus the injected key), and drops all references to the decrypted plaintext. The plaintext never enters a retained variable, a logged function argument, or a persistent object property.
5. The child process receives the key as an environment variable. The child's command line and environment block are readable by other same-user processes — this is a documented, unavoidable limit.
6. The pino structured logger declares redact paths for all credential-bearing fields, regex-scrubs known key shapes from free-text log messages and Error objects, and must never log credential blobs or fingerprints. Sinks (console, file) are guarded by the redacting serializer.
7. The PTY ring buffer and future on-disk transcripts are scrubbed at ingest time for the exact key values injected into that session. A streaming exact-match scrubber replaces matches with `[REDACTED]` before the chunk enters the ring buffer. The scrubber handles chunk-boundary cases. The raw chunk transiently exists in main-process memory before scrubbing (node-pty delivery).
8. On decrypt failure (unavailable encryption, undecryptable blob, corrupt row, profile migration), the credential profile is marked unavailable, the row is preserved, and any launch attempt for that profile is refused with an explicit error naming the profile by label. The error message must not contain the encrypted blob, any partial key material, or any derived secret.
9. The no-credential path is fully preserved: agents that authenticate via subscription login or ambient environment variables launch with no credential profile selected and no injection, exactly as they do today.

---

## The Honest Guarantee (User-Facing, Verbatim)

Chorus encrypts your API credentials on disk using Windows data protection and injects them into agent sessions as environment variables at launch time, never as command-line arguments. Credentials are never sent over the network by Chorus itself, never appear in Chorus's own log output, are never exposed to the Chorus UI or browser devtools, and are scrubbed from Chorus's stored terminal output. Chorus cannot protect against: the agent itself choosing to print, log, exfiltrate, or misuse a credential it receives; malware running under the same Windows user account (which can decrypt DPAPI-protected data or read process environment blocks); or other same-user processes that inspect the agent's environment. If decryption of a stored credential fails, Chorus refuses to launch the associated agent session rather than silently falling back to an unauthenticated state.

---

## Risks & Mitigations

1. **Risk:** An agent prints its injected key to the terminal (e.g., `echo $env:ANTHROPIC_API_KEY`, debug flag, provider error page), and the scrubber fails to catch it due to encoding tricks, ANSI interleaving, or chunk-boundary edge cases.
   **→ Mitigation:** Use exact-value matching with a streaming algorithm that handles chunk boundaries. Accept that deliberate obfuscation by the agent (base64, split writes with escape sequences) is outside the scrubber's scope and document this limit. Test with realistic key shapes and known agent output patterns.

2. **Risk:** The env allow-list omits a variable that an agent requires, breaking launch for existing agents or future adapters.
   **→ Mitigation:** Define and test a concrete baseline allow-list against both current agents (Claude Code 2.1.215, Codex CLI 0.144.6). Allow adapters to declare additional required variables in their configuration. Document the allow-list in the adapter spec.

3. **Risk:** A crash minidump or heap snapshot captures decrypted plaintext even under Option C (decrypt per launch, isolate), because the key transiently exists in a local variable during the spawn call window.
   **→ Mitigation:** The spawn window is extremely small (sub-millisecond to a few ms). The contract already names this as a limit. Consider registering the memory region for exclusion from minidumps via `MemoryProtection` APIs if Electron exposes them in a future version, but do not block v1 on this.

4. **Risk:** The SHA-256 fingerprint, if unsalted or weakly salted, could be rainbow-tabled to recover keys of known format (e.g., `sk-ant-api03-` prefix).
   **→ Mitigation:** Use a fixed, app-specific 32-byte salt stored in code (not in the database). The fingerprint is `SHA-256(salt + key)`. This prevents pre-computed rainbow tables. State in the contract that an attacker with the app binary can extract the salt — the fingerprint is for disambiguation, not authentication.

5. **Risk:** The PTY scrubber replaces key values with `[REDACTED]` in the user's visible terminal output, mutating legitimate command output and potentially misleading the user about what their agent produced.
   **→ Mitigation:** Use a distinct replacement pattern that clearly indicates redaction (e.g., `[REDACTED-CREDENTIAL]`). Document in the UI that terminal output containing credentials is automatically scrubbed. Consider a per-session visual indicator when redaction has occurred.

6. **Risk:** Future macOS/Linux ports encounter `safeStorage` backends where `isEncryptionAvailable()` returns false (e.g., `basic_text` fallback on Linux when libsecret/kwallet are unavailable).
   **→ Mitigation:** The contract's explicit refusal on unavailable encryption works correctly across platforms. For a future Linux port, document the libsecret requirement and refuse credential creation without it. Do not add a plaintext fallback.

7. **Risk:** A corrupted `shouldReEncrypt` cycle could cause repeated re-encryption on every launch, adding latency.
   **→ Mitigation:** Re-encrypt on write and track a `reencrypted_at` column to throttle re-encryption attempts (no more than once per app launch). If re-encryption fails, fall through to the undecryptable-blob failure path.

---

## Answer to Q6 (Option-Fixation Check)

**Two modifications are load-bearing; no full alternative shape is required.**

1. **Exact-value PTY stream scrubbing must be part of the contract.** Without it, the prime directive is violated — an agent printing its key makes the key observable through the ring buffer, renderer replay, and future transcripts. The majority holds that this is a Chorus-controlled surface and must be covered. If scrubbing is not implemented, the guarantee paragraph must be revised to explicitly exclude terminal buffer replay and transcripts from its protection scope.

2. **The constructed allow-list environment approach (not inherited `process.env`) must be tested against current agents before commit.** If testing reveals that either agent requires an ambient environment variable that cannot be enumerated in advance, the allow-list must expand to include a user-configurable whitelist or fall back to inheriting `process.env` with explicit stripping of known provider-key variable names. This is load-bearing for billing separation — inheriting `process.env` wholesale silently hands ambient keys to the agent, which directly undermines the motivating use case.

No full alternative shape (credential broker proxy, OS credential manager, prompt-per-launch no-storage) is argued for by any reviewer. The envelope-blob + DPAPI + per-launch-decrypt + allow-list-env design is sound with the two modifications above.

---

## Action Items for Implementation

1. **Create migration v5** with tables `provider_configs` (id, name, adapter_type, auth_mode, env_var_name, base_url, extra_headers_json, created_at) and `credential_profiles` (id, provider_id FK, label, encrypted_blob BLOB, fingerprint_hash TEXT, created_at, last_verified_at, unavailable_since, reencrypted_at). The migration must upgrade the developer's existing database in place with zero data loss.

2. **Implement `CredentialVault` service** in main process with methods: `createProfile(providerId, label, plaintextKey)`, `listProfiles()`, `replaceProfile(id, providerId, label, plaintextKey)`, `deleteProfile(id)`, `decryptForLaunch(id): DecryptedEnvelope`. `listProfiles` returns only plaintext metadata (no blobs, no fingerprints to renderer).

3. **Implement IPC channels** for credential management — all write-only inbound: `credential:create`, `credential:replace`, `credential:delete`, `credential:list`. No channel returns decrypted keys or fingerprints. Validate all inputs with Zod in main process.

4. **Implement SHA-256 fingerprint** with a fixed 32-byte app salt. Compute `SHA-256(salt + key)` at creation/replacement time and store in `fingerprint_hash`. Never expose fingerprints over IPC.

5. **Implement allow-list environment construction:** define the baseline list (`PATH`, `SystemRoot`, `TEMP`, `TMP`, `HOMEDRIVE`, `HOMEPATH`, `USERPROFILE`) and a mechanism for adapters to declare additional required vars. Test against Claude Code and Codex CLI. Document the allow-list.

6. **Implement decrypt-per-launch with variable isolation:** decrypt inside a narrowly-scoped helper function that returns the env block directly, with no reference to the plaintext retained after the function returns. Never pass the plaintext through a logged function or retained object.

7. **Implement streaming PTY scrubber:** maintain a per-session set of injected exact secret values. For each PTY output chunk, perform exact-match replacement with `[REDACTED-CREDENTIAL]` using a streaming algorithm that handles chunk boundaries (carry-over buffer for partial matches at chunk edges). Run scrub before ring-buffer append, replay, and future transcript write.

8. **Configure pino redacting serializer:** declare redact paths for `encrypted_blob`, `fingerprint_hash`, `key`, `plaintextKey`, and any credential-bearing fields. Add regex scrubbing for known key shapes (`sk-ant-api03-`, `sk-proj-`, `sk-`, `AIza`) on free-text log messages, `Error.message`, and serialized stack traces. Guard all log sinks with the serializer.

9. **Implement failure-mode handling:** on `isEncryptionAvailable() === false`, refuse credential creation with error. On decrypt failure, mark profile `unavailable_since`, keep the row, and refuse launch with error `"Credential profile '<label>' is unavailable: decryption failed. Re-enter the credential in Settings."`. Handle `shouldReEncrypt` by re-encrypting and updating `reencrypted_at` on next write. On corrupt blob, treat as undecryptable.

10. **Implement no-credential path preservation:** agent launch with no `credential_profile_id` skips all vault logic entirely. Current agents (Claude Code, Codex CLI) must launch with their existing self-authentication behavior unchanged.

11. **Implement G2 verifiability:** create a verification script that stores a known fake key, launches a session, and inspects the database blob (must not contain plaintext), the spawned process command line (must not contain the key), the spawn environment (must contain the key as the correct env var only, no ambient vars), the log output (must not contain the key), the IPC payloads (must not return the key), and the PTY buffer (must contain `[REDACTED-CREDENTIAL]` where the key was printed).

---

## Reviewer Details

### Kimi (moonshotai/kimi-k2.7-code)
| Question | Position |
|----------|----------|
| Q1 | B (envelope blob) |
| Q2 | C (decrypt per launch, isolate) + allow-list + write-only IPC |
| Q3 | Refuse launch on any decrypt failure |
| Q4 | Scrub PTY on ingest + full redaction coverage |
| Q5 | Comprehensive guarantee paragraph (contributed to synthesis) |
| Q6 | No load-bearing alternative shape |

### GLM (z-ai/glm-5.2)
| Question | Position |
|----------|----------|
| Q1 | B (envelope blob) |
| Q2 | C (decrypt per launch, isolate) + allow-list + write-only IPC |
| Q3 | Refuse launch on any decrypt failure |
| Q4 | Scrub PTY on ingest + full redaction coverage |
| Q5 | Comprehensive guarantee paragraph (contributed to synthesis) |
| Q6 | No load-bearing alternative shape |

### Qwen (qwen/qwen3.7-max)
| Question | Position |
|----------|----------|
| Q1 | B (envelope blob) + SHA-256 fingerprint |
| Q2 | A (decrypt per launch, drop) + allow-list + write-only IPC |
| Q3 | Refuse launch on any decrypt failure |
| Q4 | **Accept-and-document** PTY leak (DISSENT) |
| Q5 | Honest guarantee with PTY exception (contributed to synthesis) |
| Q6 | No load-bearing alternative shape |

---

**End of council findings.** The council's top-priority recommendation is to either add exact-value PTY stream redaction before ring-buffer retention/replay/transcript output, or to explicitly downgrade the security contract so it no longer claims protection across Chorus-controlled terminal surfaces.

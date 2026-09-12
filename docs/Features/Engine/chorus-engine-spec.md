# Chorus Engine — Specification

**Status:** admitted 2026-09-04 as Phase 10 (D191). Nothing built.
**Phase 10.1 kicked off 2026-09-12** — task docs in `Tasks/` and `ImplementationSpecs/`.
⚠ **That kickoff measured several claims in this document to be wrong and corrected them IN PLACE,
each marked with a dated `⚠ CORRECTED` note: §3.6 (F114's mechanism), §3.7 (F115's scope), §5's two
"inversions", §6's migration version and test path, and §7's key-set mirror. Where a correction note
and the surrounding prose disagree, THE NOTE IS THE MEASUREMENT AND WINS.**
**Source of intent:** `docs/Plan.md`. Current status: `docs/Features/Foundation/roadmap.md` §7, Phase 10.
**Council:** `[CR]` — see §9.

---

## 1. Why

[halv.ai](https://halv.ai/#engine) is a direct competitor whose product surface — PTY panes, 32-way
splits, subagent fan-out, write-approval rails, per-project permissions, auto-branching — **is
Chorus's existing feature set**. Its only differentiator is "the engine": a claimed ~50% token
reduction at equal answer quality, for $2–$10/month.

If that claim holds, it is the reason someone picks Halv over Chorus. This is a competitive-gap
question, not an optimisation.

**Outcome sought:** Chorus gets its own token-efficiency layer, off by default, serving Claude Code
and Codex roughly equally, with every number proved on this machine before it is trusted or repeated.

---

## 2. What Halv claims

| # | System | Claim | Their evidence |
|---|---|---|---|
| 1 | **Compression** | Strips duplicated file reads, stale history, repeated instructions from the request body | The ~50% headline |
| 2 | **Crux Code Index** | callers / references / impact from an index rather than reading the repo a file at a time | −59% tokens per correct answer on SymPy; 6/6 correct at 169,693 tokens vs grep sessions averaging 248k with four wrong |
| 3 | **Command filtering** | Trims test logs, diffs, dependency trees before the tokens are spent | 3,104 → 41 lines |

Supported: Claude Code, Codex, Kimi, GLM. Pricing $2/mo capped savings, $10/mo uncapped.

### Two omissions that decide our design

**(a) It is a proxy, and the page avoids the word.** Halv claims credentials "stay with the CLI —
Halv never reads them, never stores them, never forwards them" while sitting "in front of every
request". Both cannot be true: an intercepting layer must forward `Authorization` / `x-api-key` or
the request does not authenticate. The prior art is unambiguous —
[ClaudeSlim](https://github.com/apolloraines/claudeslim),
[tamp](https://github.com/sliday/tamp),
[headroom](https://github.com/headroomlabs-ai/headroom) all point the CLI at a local server via a
base-URL override. **§8 forbids Chorus from copying this wording.**

**(b) The page never mentions prompt caching**, which is the entire economics of system 1. See §4.

---

## 3. Ground facts — measured 2026-09-03/04, not recalled

Claude Code `2.1.259`, codex-cli `0.153.0`, both read off this machine.
Graph read live: **607 `:File`, 43 `:Directory`, 250 `:Commit`, 18 `:Memory`, zero symbol nodes**
(a `Class` label is declared by graph migration v2 `code-structure-identity` but unpopulated).

### 3.1 The capability grid — the load-bearing table

| Tier | Claude Code | Codex | opencode / kimi / grok | Capability cost |
|---|---|---|---|---|
| **1. Token ledger** | ✅ | ✅ | ❌ formats unverified | none |
| **2. Tool output + input filtering** | ✅ `updatedToolOutput`, `updatedInput` | ❌ hooks exist, **no replacement field** | ❌ opencode broken upstream, kimi/grok no hooks | none |
| **3. Code index** | ✅ | ✅ | ⚠ receives the MCP server, but `instructions: null` so it never reaches for it | none |
| **4. Proxy compression** | ⚠ possible, **expensive** | ✅ **already wired, nearly free** | ❌ no per-launch mechanism | **Claude only** |

> **The inversion that shapes the phase order: the proxy is cheap on Codex and expensive on Claude;
> the hooks are the exact opposite.** That is almost certainly why Halv leads with Codex/Kimi/GLM —
> on those CLIs, base-URL interception is the sanctioned way in.

### 3.2 F110 — the Claude Code hooks documentation is wrong about tool-output rewriting

`https://code.claude.com/docs/en/hooks` states `PostToolUse` cannot modify tool output. Grepping the
installed binary (`~/.local/share/claude/versions/2.1.259`) finds `updatedToolOutput` **12 times**
with its own schema descriptions:

- `updatedToolOutput` — *"Replaces the tool output before it is sent to the model"*
- `updatedMCPToolOutput` — *"Replaces the output for MCP tools only. Prefer updatedToolOutput, which
  works for all tools"*
- Failure path: *"PostToolUse hook returned updatedToolOutput that does not match `<tool>`'s output
  shape; using original output"* — **it validates and falls back**, fail-safe by construction.
- `updatedInput` (100 occurrences, `{behavior:'allow', updatedInput?: object}`) lets `PreToolUse`
  rewrite the tool's *input* — bound a `Read`, cap a `Grep`, filter `npm test` at source.

**Method note, and it is the reusable part:** this is the same technique the 2026-08-25 opencode
`variant` work used — read the shipped binary as text when the docs and the behaviour disagree. D4
names "the tool's own `--help`/docs" as the authority; when two of the tool's own sources conflict,
**the binary wins**.

### 3.3 F111 — an identity rewrite clobbers a sibling hook

Embedded in the same binary: *"hooks run in parallel on the ORIGINAL output, so an identity rewrite
competes last-write-wins with sibling rewrites and can clobber a real redaction."*

**Consequence, binding on Phase 10.3:** Chorus must emit `updatedToolOutput` **only when it actually
changed something**. A no-op rewrite emitted "for consistency" would silently destroy a user's own
redaction hook.

### 3.4 F112 — codex 0.153.0 has PostToolUse but cannot rewrite output

Codex carries the full lifecycle (`PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`,
`SessionStart/End`, `UserPromptSubmit`, `SubagentStart/Stop`, `Stop`, `Interrupt`) and
`features list` reports `hooks` **stable/true**. But its hook output struct carries only
`systemMessage`, `additionalContext`, `suppressOutput` — no replacement field. opencode's
`tool.execute.after` mutation is [broken upstream](https://github.com/anomalyco/opencode/issues/13574).

**So tier 2 is Claude-only.** Recorded rather than hidden, per D193.

### 3.5 F113 — `ANTHROPIC_BASE_URL` costs two documented Claude Code features

Per Anthropic's own env-var reference, pointing it at a non-first-party host:

- **disables MCP tool search by default** — every MCP tool schema moves out of deferred loading and
  into the cached prefix, on every turn. Overridable with `ENABLE_TOOL_SEARCH=true` **only if** the
  proxy forwards `tool_reference` blocks faithfully.
- **disables Remote Control** (v2.1.196+). No override — `CLAUDE_CODE_CUSTOM_OAUTH_URL` is restricted
  to an Anthropic-owned allowlist.

`API_TIMEOUT_MS` is also documented as needing to rise "when routing through a proxy".

**A compression proxy can therefore raise the Claude floor before it saves anything.** This is what
makes the A/A null-proxy experiment (§5, Phase 10.1) the cheapest possible kill shot.

### 3.6 F114 — `dispatches.tokens_cached` conflates two quantities 12.5–20× apart

`src/main/db/schema.ts:311-315` gives `dispatches` a single `tokens_cached` column with a comment
noting cached input is "~an order of magnitude cheaper". That is right about cache **reads** (0.1×)
and collapses cache **writes** (1.25× at 5-minute TTL, 2.0× at 1-hour) into the same column. They
differ by 12.5–20× and **move in opposite directions under this feature**, so the existing cost
ledger cannot express the metric that decides Phase 10. A defect worth fixing regardless.

> ⚠ **MECHANISM CORRECTED 2026-09-12 BY THE PHASE 10.1 KICKOFF — THE CONCLUSION ABOVE SURVIVES,
> THE MECHANISM DOES NOT.** `tokens_cached` does **not** conflate the two. Measured:
> `subscriptionMeter.ts:158` writes `tokensCached += cacheRead`, so the column holds cache **reads
> only**; `:156` writes `tokensIn += fresh + cacheWrite + cacheRead`, so cache **writes are folded
> into `tokens_in`**, where no column can recover them. `attributionCore.ts:352-357` agrees on the
> convention, and nothing in `src/main` persists `cache_creation` separately. **So the fix is an
> ADDITION, not the split §5 originally prescribed:** `v24` adds one nullable
> `dispatches.tokens_cache_write`, no backfill. ⚠ **403 of 467 existing rows are NULL, and NULL
> means *unknown* — coercing it to 0 would claim those sessions used no cache.**

### 3.7 F115 — restore and restart pass no launch options

`sessionManager.ts:600` (restore relaunch) and the `SessionRestart` handler at `ipc.ts:2203` — whose
`sessions.launch` at `:2258` passes `conversationBoundary: 'restart'` and nothing else — both spawn
without launch options.

> ⚠ **SCOPE CORRECTED 2026-09-12 BY THE PHASE 10.1 KICKOFF, AND THE CORRECTION MATTERS MORE THAN
> THE FINDING.** A restored or restarted pane does **not** lose its credential: a credentialed
> session never reaches either spawn. Restore heals it to `exited` titled *"Credential not
> re-supplied…"* (`sessionManager.ts:571-583`); restart refuses it inline (`ipc.ts:2238`); both go
> through `sessionIsCredentialed` (`launchProfiles.ts:127-138`, **fail-safe true**). A BYOK pane
> loses **the launch, by design**. `sessionManager.ts:567` further states the file holds **zero
> references to the vault**, so the fix must be **synchronous and credential-free** — making an
> unattended decrypt fail to COMPILE rather than merely not happen.
>
> ✅ **What is actually lost is `permissionMode`, and it loses permissively:** absent means the
> adapter's declared default and claude's is `defaultLevelId: 'auto'` (`claude.ts:540`), so **a pane
> launched in Plan or Manual comes back in Auto — closing F115 CHANGES SHIPPED BEHAVIOUR.**
>
> ✅ **And the fix is smaller than written:** `SessionRelaunch` (`ipc.ts:3190`) already rebuilds the
> option set from the persisted `launchProfileId`, and `session:launch` (`ipc.ts:1816-1843`) is a
> fourth near-identical copy — **one extracted composition with four callers**, not new machinery.

Any env-based or config-based feature is therefore **silently absent** on a restored
or restarted pane. For Phase 10 this is both a correctness bug *and* a measurement-contamination bug —
an A/B would be silently averaging a mixture. **Must be closed before the measurement, not after.**

Related trap already in the tree: `ipc.ts:1189 mergeWiringEnv` lets a launch profile's own env value
**win** on collision, so a profile setting `ANTHROPIC_BASE_URL` would silently bypass the engine.

### 3.8 The vendors are absorbing system 1

`codex features list` on 0.153.0: `enable_request_compression` **stable/on**,
`remote_compaction_v2` **stable/on**, with `context_management` and `token_budget` under development.
Building our own request-body compressor means competing with the vendor's roadmap on their wire
format, where every CLI update can break us silently.

### 3.9 What Chorus already owns

| Need | Exists | Where |
|---|---|---|
| Loopback HTTP server + per-session capability tokens | ✅ | `agentEvents.ts:752`, `:759 listen(0,'127.0.0.1')`, `:769 register()` mints `randomBytes(32)` |
| Hook settings file injected into claude | ✅ | `claude.ts:231-239` writes `--settings <file>`; dir `index.ts:558`; mint `sessionManager.ts:847` |
| Per-launch config written by main, format owned by adapter | ✅ | `mcpConfigWrite.ts:199 wireMcpForLaunch` |
| Single env-policy owner | ✅ | `env.ts:131 composeChildEnv`; spawn `sessionManager.ts:970` |
| Claude **and** codex transcript token parsing | ✅ | `contextUsageCore.ts` — `parseClaudeTranscriptTail`, `parseCodexContextLeft` |
| Per-project code index in Neo4j | ✅ partial | `codeIndexCore.ts` walks files + git log |
| Per-project on/off template | ✅ | `project_memory`, `memoryService.ts`, `ProjectSettingsView.vue:906` |
| codex `base_url` forwarding | ✅ **already shipped** | `codex.ts:241-254` |
| Free-port probing | ✅ | `docker.ts:214 findFreeBoltPort` (⚠ TOCTOU; prefer `listen(0)`) |

---

## 4. The arithmetic that kills mid-history rewriting (D192)

Let the engine delete `X` tokens at a point splitting the cached prefix into `A` (still readable) and
`B` (invalidated, must be re-written). Let `T` be the further requests against this prefix, `w` the
cache-write multiplier.

```
Break-even   T* = (w − 0.1)·B / (0.1·X)

   5-minute TTL   T* = 11.5 · (B/X)
   1-hour TTL     T* = 19   · (B/X)     ← what a Max subscription actually gets
   OpenAI/codex   T* =  9   · (B/X)     (no write premium)
```

**The whole argument is `B/X`**, and `B` is everything *after* the edit. Realistic case — 120k prefix,
delete a 6k duplicated read 40% in — gives `B/X ≈ 12`, so **T\* ≈ 138 on a 5-minute cache and ≈ 228 on
the 1-hour TTL**. Real tasks run 20–80 requests before `/compact` or `/clear`. It never breaks even.

Worse, reads only land where a previous request wrote a breakpoint (at most 4, each walking back at
most 20 positions), so real `B` is worse than this model, never better.

**On rate limits it is strictly worse, with no break-even at any parameter value.** Anthropic's
rate-limit documentation: `cache_read_input_tokens` do **not** count toward ITPM;
`cache_creation_input_tokens` do. The tokens you delete were free; the invalidation you cause is not.
For a tool sold as "extend your usage before you hit limits", this is the opposite of the claim.

**Corroboration from the category's own leading implementation.** `tamp` defaults to
`TAMP_CACHE_SAFE: true` — "compress newest only (prompt-cache safe)". Its history-rewriting stages
are **opt-in and off by default**, reason given: they "invalidate the prompt cache", and you must
"weigh the token saving against cache-read pricing". Its headline 52.6% comes from **tool-output
compression** — Halv's system 3, our tier 2 — not from history rewriting.

> **The number being copied was not produced by the mechanism being sold.**

**Therefore (D192): Chorus never rewrites conversation history. Tail-only, always.**

Shaping the newest `tool_result` *before* it enters the cached prefix costs nothing and saves
`w·X + 0.1·X·T` — unconditionally positive, no break-even to argue, and it *reduces* `cache_creation`,
the only quantity that helps ITPM. It reaches the "duplicated file read" win anyway: **at the moment a
duplicate arrives, it is the newest block.** Claude Code's own `/rewind` is the one history edit
documented as cache-safe, precisely because it truncates to an already-cached prefix.

---

## 5. Phases

Build order serves Claude Code and Codex roughly equally (Matthew, 2026-09-04).

### Phase 10.1 — Token ledger and the A/A gate (~3 days)

The instrument that proves or kills everything downstream. Ships as a usage panel regardless.

- **Whole-file** transcript scanner as a *sibling* to `contextUsageCore.ts`, not a change to the tail
  reader. Two deliberate inversions from the context ring — ⚠ **BOTH RESTATED 2026-09-12 BECAUSE BOTH
  WERE UNFOLLOWABLE AS WRITTEN:**
  - ~~**include sidechains**~~ → **walk the subagent DIRECTORY.** Claude Code `2.1.259` no longer
    writes sidechains into the transcript at all — **0 of 268 main transcripts carry an
    `isSidechain: true` line** — and subagent work lives in `<sessionId>/subagents/agent-*.jsonl`.
    It is **53–65% of `CE` and 75–90% of `RLIT`**, so the narrow read is ~2.5× wrong on the
    sessions that cost most (**F116**, **F117**, **D196**). ⚠ Filter on `.jsonl`: the sibling
    `agent-<id>.meta.json` carries a human-written `description`.
  - ~~**include `output_tokens`** (weighted)~~ → **raw and separate.** `model_catalog` has no price
    columns, so there is no ratio to weight with and **`CE_total` is dropped from v1**. Better
    anyway: a fall in output tokens is the signature of a silent thinking-disable (§7), which a
    blended figure would hide *as a saving*.
- Metric — four numbers, always reported together:
  ```
  CE       = input + 1.25·eph5m + 2.0·eph1h + 0.1·cache_read
  CE_total = CE + (out/in price ratio)·output
  RLIT     = input + cache_creation                       # exactly what ITPM charges
  Naive    = input + cache_creation + cache_read          # the metric that lies
  ```
  **Report `Naive` beside `CE` deliberately — the gap between them is the finding.** Worked example:
  a request where `Naive` reads −19% is `CE` 5.1× worse and `RLIT` 17.7× worse.
- **Normalise per completed task**, never per request or session.
- Close **F115** first (restore at `sessionManager.ts:600` + restart at `ipc.ts:2203`/`:2258`).
- Fix **F114**: ⚠ **CORRECTED 2026-09-12 — NOT a split.** `tokens_cached` holds cache **reads**
  only; cache **writes** are folded into `tokens_in` (`subscriptionMeter.ts:156`) where no column
  recovers them. `v24` **adds** one nullable `dispatches.tokens_cache_write`, **no backfill**, both
  existing columns keeping their meanings. NULL means *unknown* and must never be coerced to 0.
- ⚠ **Widens a deliberately narrow boundary.** `contextUsage.ts:19-49` records that it opens one file,
  reads a 256 KB tail, parses three integers, and that content never leaves the module. A whole-file
  scanner needs its own header note and its own decision — the same shape as candidate C1's
  "deliberate second widening".

**Files:** new `engineLedgerCore.ts` + `engineLedger.ts` · `schema.ts:311` · `storage.ts:175` (v24) ·
`contextUsage.ts` header · `sessionManager.ts:600` · `ipc.ts:2258`.

### Phase 10.2 — Code index: the symbol layer (~6–8 days) — *Claude and Codex*

- Extend `codeIndexCore.ts` to emit `:Symbol` nodes and `CALLS` / `REFERENCES` / `DEFINED_IN` edges
  beside the existing `:File` / `:Directory` / `:Commit`. **Graph migration v3** on the existing
  `ChorusMigration` framework (verified at v2, `GRAPH_MIGRATIONS` = [1,2]).
- **Parser:** the TypeScript compiler API. `typescript ^5.9.3` is already in the tree as a
  devDependency; runtime use means promoting it to `dependencies`. **No new third-party code, but a
  real packaging change — needs Matthew's sign-off per CLAUDE.md.**
- ⚠ **Honest scope limit: TS / JS / Vue script blocks only in v1.** Halv's benchmark repo was SymPy —
  Python — which we would not cover at all. The UI must say so rather than showing a Python project an
  empty index.
- New MCP tools on the existing `chorus-memory` server: `find_callers`, `find_references`,
  `impact_of`. Per-agent delivery already solved (`claude.ts:432` project-file, `codex.ts:723`
  launch-args, `opencode.ts:355` env-named-file).
- Contract lines telling the agent to query before grepping. **Reuse the measured phrasing shape from
  the 2026-08-30 `project-memory` skill A/B:** the description must lead with the *trigger situation*,
  not the subject noun. Same model, same prompt, description-only change flipped it from never firing
  to firing first.
- ⚠ Only claude and codex receive an instruction contract; opencode/kimi/grok declare
  `instructions: null` and will get the tools but never reach for them. Not a defect to fix here.

### Phase 10.3 — Tool output and input filtering (~3–4 days) — *Claude Code only*

Halv's system 3 — the tier with the strongest real evidence behind it (§4).

- `PostToolUse` returns `updatedToolOutput`; `PreToolUse` returns `{behavior:'allow', updatedInput}`.
- **Transport, and it inverts an existing rule.** The hook pipes stdin to Chorus's loopback endpoint
  and writes the response to stdout:
  `curl -sS --max-time 5 --data-binary @- http://127.0.0.1:<port>/filter/<token>`
  On failure curl writes nothing → no rewrite → **fail-open for free**. But the existing lifecycle
  hooks use `-o NUL` *precisely because hook stdout is a control channel*. **Two hook entries with
  different shapes:** lifecycle keeps `-o NUL`; the filter deliberately does not. Getting this wrong
  corrupts every lifecycle event.
- **Never emit an identity rewrite** (F111).
- **The toggle is live, not launch-time:** the hook is always installed and the endpoint consults the
  current setting per call, so a bad rule dies without relaunching a pane.
- ⚠ **This reverses a documented posture and is the main reason for `[CR]`.** `agentEvents.ts:44-72`
  states that exactly three fields are read off a hook body — `hook_event_name`, `transcript_path`,
  `tool_name` — and explicitly **not** `tool_input` or `tool_response`. Filtering requires reading
  `tool_response`. Needs its own decision, its own header note, and a written rule that filtered
  content is never persisted and never logged.
- Rules v1, conservative, each individually toggleable: collapse passing test output to failures +
  counts; truncate dependency trees; cap `Grep` result sets **with an unmissable elision marker
  carrying the true count**; drop ANSI noise. Every elision visible to the model, never silent.

**Files:** new `toolFilterCore.ts` (pure, unit-tested) + `toolFilter.ts` · `agentEvents.ts` ·
`claude.ts:231-239` · `sessionManager.ts:847`.

### Phase 10.4 — Codex proxy probe (~0.5 day), then a decision

The cheap half of tier 4. `codex.ts:241-254` already emits `-c model_providers.<k>.base_url` — no
OAuth redirection, no lost features, no consent dialog.

- Stand up a pass-through listener on the `agentEvents.ts:752-786` pattern, point one codex session at
  it, capture one real request body.
- **The one question:** Codex speaks the Responses API and may hold conversation state server-side via
  `store` / `previous_response_id`. If it does, **there is no history in the body to compress and
  tier 4 is dead for codex** — killed for half a day instead of ~17.
- If history is present: build the tail-only transform (§4), fail-open, audit panel. **Report back
  before committing to the build.**

### Not built — the Claude proxy (D194)

Specified here so it is not re-litigated. Unlocked only if 10.1's ledger earns it.

Against it: the §4 arithmetic · F113's two lost features · and **the proxy makes Chorus a hard runtime
dependency of every model call** — today a Chorus crash loses the UI; with the proxy it kills every
in-flight agent turn.

If ever built, these are non-negotiable:

- **Run the A/A null-proxy experiment first** — same build, proxy inserted, compression disabled,
  byte-for-byte pass-through. If `CE` rises in the null arm, the interception itself costs money.
  **Prediction: it will**, via F113's MCP tool-search loss.
- Never buffer responses. **Relay SSE `ping` events verbatim** — a 300 s byte-level watchdog aborts
  silent streams, and pings are the only traffic during long thinking pauses.
- **Forward error bodies unmodified** — Claude Code's capability-downgrade retry matches on the
  upstream's error wording.
- `socket.setNoDelay(true)`, no compression middleware, no `Content-Length` rewriting.
- Set `ANTHROPIC_BASE_URL` **only**, never `ANTHROPIC_AUTH_TOKEN` — the latter silently moves the user
  off their subscription onto per-token billing. Must be **structurally impossible**, not merely
  avoided.
- **Capability-rejection circuit breaker.** On a 400 mentioning `thinking`, `signature` or
  `cache_control`: permanently disable rewriting for that session and re-issue the original bytes.
  Otherwise Claude Code's own retry succeeds by **disabling thinking for the rest of the
  conversation** — output tokens fall, which *reads as a saving*, while the agent has been lobotomised
  and nothing surfaces.
- **Never normalise the `system` array.** `api.anthropic.com` strips Claude Code's attribution block
  *positionally*; a merged array causes it to drop the entire system prompt. The session keeps
  running — it just isn't Claude Code any more.
- TLS: originate upstream HTTPS through Electron's global `fetch` behind the existing `FetchLike` seam
  — no new dependency, and Chromium's stack honours the Windows system trust store. Listen plain HTTP
  on `127.0.0.1` with `listen(0)`. Do **not** terminate TLS locally.
- **The forwarded OAuth token is a new class of secret** — one the CLI *originates* and hands to
  Chorus. safeStorage, `vault.ts:202 decryptForLaunch` and the Scrubber cover secrets Chorus
  *injects*, not this. Needs its own written policy before a line is written.

---

## 6. The on/off design

Mirrors `project_memory`, the established per-project template.

- **Per-project row** `project_engine` (migration **`v25`** — ⚠ **was `v24`; Task 10.1-3 took `v24`
  for `tokens_cache_write` on 2026-09-12, so this table MUST take the next free version or the two
  collide silently on a shared dev DB**) with one
  column per tier — `ledger_enabled`, `index_enabled`, `filter_enabled`, `proxy_mode`
  (`'off' | 'codex'`) — because the tiers have genuinely different risk profiles and must be killable
  independently.
- **App-level defaults** in the existing `settings` k/v table as one JSON value, the `voiceSettings`
  shape — **no migration needed**.
- **All tiers ship OFF.**
- **Live where possible.** Ledger and index toggle live. The filter is live too (§5, 10.3). Only the
  proxy's *route* is fixed at spawn — so the toggle flips the transform, not the route, and the UI
  must say plainly that an existing proxied pane needs a relaunch to become un-proxied.
- **Per-agent capability line in the settings UI** (D193): a codex pane must read "filtering not
  supported by codex 0.153.0", never look broken. Same for a Python project against a TS-only index.
- **Visible per-pane state** beside the existing activity light.
- **Kill switches at three levels** — global, per-project, per-session — plus automatic kills: the
  circuit breaker, and a hard rule that any session which ever saw a 400 stays un-rewritten for life.
- **Audit panel per session**: requests seen, requests modified, tokens removed by rule, `CE` before
  and after, cache-read share before and after, pass-throughs, rejections, breaker state.
- **Provenance lives in a bounded in-memory ring, never on disk.** Showing *what* was removed means
  retaining the removed text, which is the user's source code. **No on-disk request-body audit log** —
  it would contain the entire codebase and, done carelessly, the bearer token.
- **Undo is honest**: "turn it off and relaunch". There is no un-eliding content the model has already
  reasoned about. Say that rather than implying reversibility.

**The toggle touches:** `storage.ts:175` (**`v25`**, see above) + accessors · `schema.ts` (hand-mirrored DDL — D7 keeps
these in step by hand) · `shared/ipc.ts` channels + Zod (⚠ **two `IpcChannel` `toHaveLength`
assertions must move**, ⚠ **`src/shared/ipc.test.ts`** — NOT a bare `ipc.test.ts`, and there is no
`src/main/ipc.test.ts` to find — at `:3642` and `:4102`; **re-verified 114 keys, 0 spreads,
2026-09-12**; Task 10.1-3 takes it to **116**) ·
`main/ipc.ts` handlers, parse in **and** out · `preload/index.ts` thin forwarder, **no Zod** (D1) · a
Pinia store · a new `<section class="ps-section">` in `ProjectSettingsView.vue`.

---

## 7. Verification

- **Unit:** pure cores (`engineLedgerCore`, `toolFilterCore`, the symbol extractor) under vitest, the
  established split. Fixtures include a real transcript with sidechains and a 1-hour-TTL
  `cache_creation` breakdown.
- **Contract:** the two `IpcChannel` count assertions; a key-set assertion on the engine status schema
  proving no file content and no token ever crosses the wire. ⚠ **The mirror is `src/shared/ipc.test.ts:4137`
  (`:4138` is its first body line), and its assertion CANNOT BE COPIED VERBATIM: `:4152` bars any field
  name matching `/key|secret|token|blob|fingerprint|password|value/i`, which a ledger payload fails by
  construction. Substitute a stronger check for this shape — assert every value in the totals object
  is a `number`, since content could only cross as a string.
- **Live app, CDP on 9222**, profile seeded from the installed DB (plain `npm run dev` has no
  credentials): toggle each tier in Project Settings; confirm a claude pane filters and a codex pane
  shows the capability line rather than an error.
- **A/B protocol (10.1):** three task shapes × 5 repetitions × 2 arms = 30 paired sessions,
  git-reset between runs, order randomised (A→B and B→A) to cancel warm-cache and learning effects.
  **Report median and IQR, never mean** — per-task counts are heavy-tailed, one retry loop doubles a
  session. At n=5/cell only effects >~30% are detectable, which is adequate when the claim is 50%.
  Task shapes: (1) narrow edit in a known file, ~10 turns — where compression has nothing to work
  with; (2) exploratory bug hunt with many re-reads — the claimed win; (3) long refactor crossing a
  compaction boundary — the cache stressor.
- **Quality is a gate, not a measurement.** On 10 tasks with deterministic outcomes: zero 400s, **zero
  silent thinking-disables** (assert `thinking` blocks keep appearing for the whole session), zero
  elision incidents. A gate that trips is a kill. **A gate that holds is not evidence of "no quality
  loss" and must never be reported as such** (D195).
- **Graph (10.2):** `MATCH (s:Symbol) RETURN count(s)` non-zero, and `find_callers` on a known Chorus
  function returns what the editor's own find-references returns.

---

## 8. What Chorus will not say (D195)

- **Not** "your credentials never leave the CLI." If the proxy ever ships, the honest wording is that
  every request — the login token and the contents of every file the agent has read — passes through
  Chorus's own process on this machine before Chorus forwards it over HTTPS; nothing goes anywhere
  else and nothing is written to disk. Plus, for subscription users: Chorus points the agent at itself
  but never replaces the Claude login, so the subscription and its limits still apply.
- **Not** "50% fewer tokens, no quality loss." Chorus reports measured cost deltas with an IQR, on its
  own machine, per completed task. Nothing in this spec lets one developer substantiate a quality
  claim — **and the one measurable proxy for quality loss is a number that looks like a saving.**

---

## 9. Council review triggers

Three of §4's criteria in `docs/Features/Foundation/roadmap.md` fire:

1. **DB schema growth** — migration **`v25`** for `project_engine` (10.1 took `v24`), graph migration v3.
2. **Security-sensitive surface** — the proxy forwards a bearer token the CLI originates; the filter
   handles the user's source code in main.
3. **A reversal of a documented posture** — `agentEvents.ts:44-72` promises `tool_response` is never
   read. Phase 10.3 requires reading it.

Suggested brief: whether 10.3's widening is acceptable and under what written bounds; whether the
ledger's whole-file transcript read needs the same treatment; and whether D192 (never rewrite history)
should be a locked rule rather than a decision.

⚠ Per the memory-graph finding of 2026-08-30, the brief's status line must say "answer these
questions, do not review this document", and elaboration sub-lists inside the questions section must
be avoided or the question count multiplies.

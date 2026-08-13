# Task 4a-2 — The Adapter Resume Contract (Claude + Codex)

_Phase 4a, task 2 of 4. **One narrated commit (G3).** This task makes two adapters able to say "start this conversation with a known id", "go back to this conversation" and "that resume failed, and here is why" — and makes them stop declaring `sessionResume: null`. **Nothing calls the new surface in this task**; the wiring is 4a-3. This task governs scope; `ImplementationSpecs/ImplementationSpec-4a-2.md` governs exact contents._

_**Revised 2026-08-13 against `a6fab79`**, after CR-4a.0 ruled. The pre-council draft's speculative sections are gone; its Non-Goals largely survive, and the three that changed say so._

> **✅ THE COUNCIL GATE IS LIFTED. D139 IS RESOLVED 2026-08-13 BY CR-4a.0, AND THIS TASK IS UNBLOCKED.**
>
> The findings are at `CouncilBriefs/CouncilBrief-4a.0-ResumeContract-Findings.md`. **⚠ Read the partial-run banner at the top of them before you rely on anything inside:** 3 of 4 members completed, GLM 5.2 returned **no verdict token on any of the seven questions**, and nothing in the document was compiled, executed or tested by anyone who could see this repository.
>
> **⚠ D143 — the six coordinator amendments — is BINDING on this task and is not optional colour.** Four of the six are yours: **(a)** the classifier reads post-scrub text, **(d)** `--session-id` must be re-verified **interactively**, **(e)** `--resume` may never be emitted bare, **(f)** `ResumeDescriptor` is on the IPC wire and its Zod schema must move with it. **(b)**, **(c)** and **(g)** belong to Task 4a-3 — do not implement them here.

## Source Of Truth

- `CouncilBriefs/CouncilBrief-4a.0-ResumeContract-Findings.md` — the ruling, the verbatim TypeScript, and the per-file change list. Action items **1–5** are this task's; **6–9** are 4a-3's.
- Roadmap §6 **D139** (**RESOLVED 2026-08-13** — the shape as approved), **D140** (**RESOLVED** — claude assigns, codex discovers, and the capability declares which), **D143** (**ADOPTED 2026-08-13** — the six amendments), **D142** (the pointer's rotation contract, 4a-1's).
- Roadmap §6 **D4** (verify CLI flags against the tool's own `--help`, never training memory — locked in `CLAUDE.md`), **D34 Q1** (declared and implemented are ONE fact — **now enforced structurally rather than by name-pairing, see Q5**), **D45(1)** (scrubbing is a property of "a session emits text"), **D46/D47** (route and env ownership), **D52** (adapter registry shape), **D1** (the wire says what is true).
- **F26** — the live A/B that found unredacted output reaching a new destination. Amendment (a) exists because a failure classifier is a new destination.
- `src/main/adapters/types.ts` — `PtyLaunchSpec` at **:233** (**eight** fields), `ResumeDescriptor` at **:180**, `ResumeSpec` at **:351** (deleted by this task), `SupportsResume` at **:574** (redefined), the `supportsResume` guard at **:621**, and its two siblings `supportsMcp` at **:606** and `supportsHooks` at **:614** — the house pattern this task must match.
- `src/main/adapters/claude.ts:100` and `src/main/adapters/codex.ts:82` — the two `sessionResume: null` declarations this task retires, with the comments explaining *why* they were null at `claude.ts:85`–`:88` and `codex.ts:71`–`:73`. **Both comments must be rewritten, not deleted** — a stale comment explaining a value that changed is worse than none.
- `src/shared/ipc.ts:2219` — `resumeDescriptorSchema` (`mode` at **:2220**); **:2224** `agentCapabilitiesSchema`; **:2231** its `sessionResume` field. **In scope, per amendment (f).**
- `src/main/adapters/capabilities.ts:35` — the detected-override merge for `sessionResume`.
- `src/main/adapters/registry.ts:35` — `staticRegistry`, which holds **exactly four** adapters.
- `docs/Features/Foundation/AdapterAuthoring.md` — the house rules for adding to an adapter.

## Goal

Give the adapter layer a truthful, per-CLI answer to three questions — _"can I name this conversation at launch?"_, _"how do I reopen it?"_ and _"did reopening it fail, and why?"_ — with `claude` and `codex` both answering, in the two structurally different ways their CLIs actually work, **through the one launch path that already exists.**

## The contract, as ruled

**One launch path. `buildLaunch(spec)` remains the only launch entry point in the app.** `PtyLaunchSpec` gains an optional modifier; `ResumeSpec` and `SupportsResume.resumeSession()` are **deleted**. Argv grammar stays **inside each adapter's own `buildLaunch`** (Q2) — no shared argv rewriter, no middleware, no post-processor, because every one of those moves vendor grammar into code that must then understand subcommands and positional order.

The dedicated-method alternative was rejected for one reason, and it is the reason this decision existed: **a second entry point rebuilds credential, route, effort, `extraArgs` and hook handling beside the first, and the two must then agree forever.** D33 owns credential injection and would have had two homes.

**⚠ THE COUNCIL ADDED SOMETHING THE BRIEF DID NOT ASK FOR, AND IT IS THE MOST IMPORTANT LINE IN THE RULING.** The modifier must model **assigned creation** as well as resumption. Claude must receive the Chorus-minted id on its **first** launch, not only on a restore — otherwise there is nothing to write down and nothing to resume later. So the modifier carries an `action` of `'create' | 'resume'`, and a field named `resume` legally contains a `create`.

**All three members raised the naming objection independently, and all three then accepted it.** It is recorded here rather than smoothed over: `spec.resume` is the **agent-session launch modifier**, and its name is the cheapest available price for not having two launch APIs. Do not "fix" it by adding a second field.

The shape, in one table:

| | Descriptor `kind` | Fresh launch | Resume launch | Companion method |
|---|---|---|---|---|
| **claude** | `'assigned'` | `--session-id <uuid>` (Chorus mints it) | `--resume <uuid>` | `classifyResumeFailure` only — `discoverSessionId` must be **absent** |
| **codex** | `'discovered'` | **no modifier, argv unchanged from HEAD** | `resume <uuid>` (subcommand + positional) | `discoverSessionId` **and** `classifyResumeFailure` |
| **kimi / opencode** | — | `sessionResume: null`, unchanged | — | none |

**Q5 — honesty stops being a name-pairing and becomes a structural check.** The generic `['sessionResume', 'resumeSession']` row is **removed** from the `EXTENSION_METHODS` table (`adapters.test.ts:908`, the row itself at `:911`); its `mcp` and `hooks` rows stay. In its place: `supportsResume()` verifies the descriptor is non-null, that `classifyResumeFailure` is a function, and that the descriptor's **kind matches the methods present** — `assigned` forbids `discoverSessionId`, `discovered` requires it. Plus tests that assert the **exact expected argv**, not merely that two argv arrays differ.

The exact TypeScript — including the two places where the ruled text does not fit this tree and what to write instead — is `ImplementationSpec-4a-2.md` §4. Reproduce it from there, not from memory of this table.

## Exact Scope

| File | Change |
|---|---|
| `src/main/adapters/types.ts` | **Edit.** Add `resume?: AgentSessionLaunch` to `PtyLaunchSpec` (`:233`). Discriminate `ResumeDescriptor` (`:180`) on `kind`. Add `AgentSessionLaunch`, `DiscoverSessionContext`, `ResumeFailureReason`, `ResumeExitObservation`. **Delete `ResumeSpec` (`:351`).** Replace `SupportsResume` (`:574`) and the guard (`:621`). |
| `src/main/adapters/claude.ts` | **Edit.** Emit `--session-id <uuid>` on assigned/create, `--resume <uuid>` on assigned/resume, **and neither on an empty pointer (amendment (e))**. Declare a non-null `assigned` descriptor at `:100`. Implement `classifyResumeFailure`. |
| `src/main/adapters/codex.ts` | **Edit.** Produce the `resume <uuid>` subcommand argv shape when the modifier is present. Declare a non-null `discovered` descriptor at `:82`. Implement `discoverSessionId` and `classifyResumeFailure`. |
| `src/shared/ipc.ts` | **Edit — ⚠ DELIBERATE SCOPE ADDITION, see below.** `resumeDescriptorSchema` (`:2219`) gains `kind`. |
| `src/main/adapters/capabilities.ts` | **Edit only if** the discriminated descriptor requires it — `:35` already merges `sessionResume` field-for-field and probably does not. |
| `src/main/adapters/adapters.test.ts` | **Edit.** See Test Expectations — the named table at `:596` and the `EXTENSION_METHODS` row at `:911`. |

Nothing else. **No `src/main/services/sessionManager.ts`, no `storage.ts`, no preload, no renderer, no new IPC channel, no npm dependency.**

> **⚠ `src/shared/ipc.ts` IS IN SCOPE, AND THE PRE-COUNCIL VERSION OF THIS DOCUMENT EXPLICITLY EXCLUDED IT. THAT EXCLUSION IS OVERTURNED BY AMENDMENT (f).**
>
> `resumeDescriptorSchema` (`:2219`) feeds `agentCapabilitiesSchema` (`:2224`, field at `:2231`), which feeds `adapter:list`. The findings list *"renderer-facing IPC channels, `IpcChannel`, and renderer code"* as explicitly unchanged, and **`IpcChannel` does stay 86** — no channel is added. But **`z.object` STRIPS unknown keys rather than rejecting them**, so a `kind` added to the runtime object and not to the schema **vanishes on the wire with no error anywhere**. The renderer never reads `sessionResume` (grep-verified), so nothing breaks either way. The schema is updated because **D1 says the wire says what is true**, not because something is failing.
>
> **⚠ AND THIS IS WHY `mode: DescriptorMode` STAYS.** Three council members flagged it as surplus beside `kind` and the council retained it for "compatibility". The real reason is that it is a **validated wire field** with a schema entry at `:2220`. The council's caution landed correctly for a reason it could not see. **Do not remove `mode` in this task.**

## Non-Goals

- **⚠ NOTHING CALLS THE NEW SURFACE IN THIS TASK.** `src/main/services/sessionManager.ts` is **byte-identical to HEAD**. No launch passes a `resume` modifier, nothing invokes `discoverSessionId`, nothing calls `classifyResumeFailure`. The adapters gain a capability; **4a-3 uses it**. A reviewer who finds a caller has found a scope violation. _(The findings' file list says `src/main/sessionManager.ts`; the file is at **`src/main/services/sessionManager.ts`** — D143's recorded correction.)_
- **⚠ `kimi.ts` AND `opencode.ts` ARE BYTE-IDENTICAL TO HEAD AND KEEP `sessionResume: null`.** Both carry explicit warnings that their `-c` means `--continue` and would **silently resume a stale session** (`kimi.ts:136`, `opencode.ts:204`). Adding them "while we're in here" is exactly the failure those comments were written to prevent. **Grok asked specifically for a test that they also IGNORE a `resume` field if one is passed** — see Test Expectations.
- **No flag is written from memory.** D4 is locked in `CLAUDE.md`. Every token this task emits must be re-verified against the installed CLI's own `--help` **at implementation time** — the Overview's §3 table was measured 2026-08-12 against claude (current) and codex-cli **0.147.0**, and both move fast. **Amendment (d) makes one of those re-verifications interactive rather than `--help`-only.**
- **No `--fork-session`, no `--continue`/`--last`, no picker invocation.** `--continue` and `codex resume --last` resume *the most recent conversation for the directory*, which is emphatically not "this pane's conversation" when several panes share a cwd — the exact bug `kimi.ts` and `opencode.ts` warn about. **Resume is by explicit id or not at all.** Amendment (e) turns this from a principle into an argv guard.
- **⚠ NO FILESYSTEM ACCESS ON THE LAUNCH PATH, AND THE LINE MOVED — READ THIS.** The pre-council version of this document said flatly *"no filesystem access from an adapter; discovery is 4a-3's, in main."* **The council overruled that**: `discoverSessionId` is a method on the **codex adapter**, because a `SessionManager` that reads rollout headers is shared code that has learned a vendor file format — Q2's reasoning applied to files instead of argv. The narrowed rule this task ships under:
  - **`buildLaunch` stays synchronous and touches nothing.** It stats no transcript, opens no directory, and is byte-identical in cost to HEAD.
  - **`discoverSessionId` may read `~/.codex/sessions` rollout headers, and nothing else.** No watchers, no polling loop, no timers owned by the adapter, and **never `session_index.jsonl` as identity evidence** (F57: it carries no `cwd`).
  - **Its invocation, bounding, abort and persistence are 4a-3's.** This task ships a function nobody calls.
- **No credential, route, effort or hook behaviour change on the normal launch path.** **A launch with no `resume` field must produce BYTE-IDENTICAL argv to HEAD, for all four adapters.** This is the regression that would be hardest to notice and most expensive to have shipped, and amendment (d) raises its stakes: claude's assigned path puts a new flag on **every** launch, not merely restores.
- **No resume-failure policy.** `classifyResumeFailure` **returns a reason**. It does not clear a pointer, relaunch, badge, log or notify. Every consequence is generic and lives in 4a-3 — amendments (b) and (c) are 4a-3's for exactly this reason.
- **No scrollback or restart work.** Amendment (g) and D142's scrollback half are **4a-3's**.
- **Do not revert, stage, or commit unrelated or untracked files** — see Overview §6.

## Dependencies

- **Task 4a-1** — **LANDED 2026-08-13** (`bbf6d32`), migration **v19**. Not a compile dependency, but the sequence matters for review.
- **The council review on D139** — **DISCHARGED 2026-08-13.** No remaining gate.

## Test Expectations

In `adapters.test.ts`, which already owns the capability-honesty suite.

**The `supportsResume` named-table row at `:596` must change.** It currently asserts `supportsResume` is **false for every adapter** (the `expect` at `:598`), with a comment calling resume _"the only one left that is genuinely false"_. After this task it is **true** for `claude` and `codex` and **false** for `kimi` and `opencode`. **Rewrite it into the named two-value idiom the `supportsMcp` block below already uses; do not delete the test** — its whole job is catching a descriptor that drifts from its methods, which is now a stronger claim than it was, not a weaker one.

> **⚠ CORRECTION TO THE PRE-COUNCIL DOCUMENT: THE TABLE IS FOUR ADAPTERS, NOT FIVE.** The old text said `noHarness` must remain false. **`noHarness` has no adapter object** — `staticRegistry` (`registry.ts:35`) holds exactly `claude`, `codex`, `kimi`, `opencode`, and D84 keeps `noHarness` out of it deliberately. Its `sessionResume: null` lives at `noHarness.ts:85` and is asserted where its descriptor is asserted, not here. The coverage test at `adapters.test.ts:574` — _"covers every registry adapter — the loops below cannot silently shrink"_ — is what stops the new named table from quietly losing a row.

**Remove the `['sessionResume', 'resumeSession']` row from `EXTENSION_METHODS`** (`adapters.test.ts:908`; the row at `:911`). `resumeSession` no longer exists and claude will declare a descriptor without it, so the generic pairing would **fail on a true statement**. **Remove that one row; `['mcp','writeMcpConfig']` and `['hooks','writeHooksConfig']` stay untouched.** The surrounding comment must record that resume left this table for the structural guard rather than because it was weakened (Q5).

**Argv assertions per adapter, in the `:291`/`:408` style** that already guards against a copied `buildLaunch` silently resuming a stale session. **Q5 requires EXACT argv** — a test that only proves two arrays differ passes for an adapter that appended garbage:

- claude, fresh launch **without** a modifier → argv **byte-identical to the HEAD snapshot**.
- claude, `{strategy:'assigned', action:'create'}` → exact array containing `--session-id <uuid>`, **not** `--resume`.
- claude, `{strategy:'assigned', action:'resume'}` → exact array containing `--resume <uuid>`, **not** `--session-id`. The live `Session ID … is already in use.` error proves they are mutually exclusive.
- **claude, a modifier whose `agentSessionId` is the empty string → NEITHER flag appears, and no bare `--resume` reaches argv (amendment (e)).** This is the test that stops a session picker opening in a pane nobody is watching.
- codex, fresh launch **without** a modifier → argv **byte-identical to the HEAD snapshot**, `CODEX_BASELINE_ARGS` still a genuine prefix.
- codex, `{strategy:'discovered', action:'resume'}` → the `resume` token and the id **positional**, in the measured order, with **no `-c` used as a continue flag** and the route/effort/status-line overrides **still present**.
- kimi and opencode → `sessionResume` still `null`, `supportsResume` false, **and `buildLaunch` called WITH a `resume` field produces argv identical to `buildLaunch` called without one.** An adapter that silently honours a modifier it never declared is the first risk the ruling names.

**Structural-support assertions:** every non-null descriptor satisfies `supportsResume()`; `codex` exposes `discoverSessionId` as a function; **`claude` does NOT expose `discoverSessionId` at all** — asserted explicitly, because `?: never` is a compile-time claim and this is its runtime half; both capable adapters expose `classifyResumeFailure`.

**`classifyResumeFailure` fixture tests.** Feed each adapter a `ResumeExitObservation` built from its **measured** failure output:

- claude, unknown id (`No conversation found with session ID: <uuid>`) → `'not-found'`;
- claude, id already live (`Error: Session ID <uuid> is already in use.`) → `'in-use'`;
- claude, a clean successful exit → **`null`**, which is the case that stops every ordinary exit from being read as a failed resume;
- codex, its measured resume-failure output → its reason, and a clean exit → `null`.

**The D139 risk case, kept from the pre-council document because the ruling reduced this risk rather than removing it.** One test that a resume launch carrying **credential + route + hooks** returns a request preserving **all three**. The whole decision turned on a second launch path dropping them; the single path must be shown not to.

## Verification Commands

```bash
claude --help | grep -E -- "--session-id|--resume|--fork-session"   # D4, at implementation time
claude --version                                                     # record it
codex resume --help                                                  # D4, at implementation time
codex --version                                                      # record it; 0.147.0 when specced
npm run typecheck
npm test
npm run grep:secrets
```

**And the one that is not a command (amendment (d)): an INTERACTIVE claude launch with `--session-id`.** See `ImplementationSpec-4a-2.md` §3 for the five-step protocol. `--help` output is not sufficient evidence for this one.

## Acceptance Criteria

1. `npm run typecheck` exits 0; `npm test` passes with **no count regression** against **56 files / 1888 tests** (measured 2026-08-13 at `a6fab79` — the previous 53/1837 figure was `82e16d7`'s and is stale); `npm run grep:secrets` clean. **`IpcChannel` still 86**, and no new channel exists.
2. Both CLIs' resume surfaces were **re-verified against their own `--help` this session**, with the observed output pasted into `_verify/4a-2/`. Both versions recorded.
3. **⚠ `claude --session-id <uuid>` was verified in an INTERACTIVE launch, not only in `-p` print mode, and not only from `--help` (amendment (d)).** The evidence — the session appearing under that exact id after an interactive run — is in `_verify/4a-2/`. **D4 does not accept "probably", and this flag now lands on every claude launch in the app, not only on restores.**
4. **⚠ No code path can emit a bare `--resume` (amendment (e)).** `claude --help` says verbatim: *"-r, --resume [value] — Resume a conversation by session ID, or open interactive picker with optional search term."* **The value is optional to the CLI**, so an empty or undefined pointer does not error — it drops a session picker into the pane and waits for a human who is not looking. The guard is explicit in the adapter and covered by a test: **no value, no flag.**
5. **⚠ `ResumeExitObservation.output` is documented, at the type, as the POST-SCRUB string from the single emit path in `sessionOutput.ts` (amendment (a)).** A classifier reading session output is a **new consumer of session text**, and D45(1) makes scrubbing a property of "a session emits text": one `scrubber.push()` per chunk feeds the ring buffer, the broadcast and the disk mirror, and this must hang off that same computed string. **A tap on raw PTY bytes here is F26's exact shape.** The *type* and its documented constraint ship here; the *wiring* is 4a-3's.
6. `supportsResume(claudeAdapter)` and `supportsResume(codexAdapter)` are **true**; `kimi` and `opencode` remain **false** — asserted, not inspected. `claude` has **no** `discoverSessionId`; `codex` has one.
7. **A no-resume launch produces argv byte-identical to HEAD for all four adapters.** Show the captured argv diff, not a claim.
8. `resumeDescriptorSchema` carries `kind` and round-trips a real descriptor through `agentCapabilitiesSchema` **without stripping it** — demonstrated by parsing claude's actual capabilities object and asserting `kind` survived.
9. `git diff --stat` touches only the files in Exact Scope. `kimi.ts`, `opencode.ts` and `services/sessionManager.ts` appear nowhere in it.

## Review Checklist

- [ ] The ruling was read from the findings document, partial-run banner included, not from this summary.
- [ ] `ResumeSpec` and `resumeSession()` are **gone** — grep proves no reference survives anywhere in `src/`.
- [ ] `buildLaunch` is still the only launch entry point; no second path was added under any name.
- [ ] Every emitted flag re-verified against the CLI's own `--help`, with output captured (D4).
- [ ] **`--session-id` re-verified INTERACTIVELY (amendment (d)), evidence captured.**
- [ ] **A bare or empty-valued `--resume` is impossible by construction and by test (amendment (e)).**
- [ ] **`ResumeExitObservation.output` is documented as post-scrub, citing D45(1) and F26 (amendment (a)).**
- [ ] **`resumeDescriptorSchema` gained `kind`; `mode` was NOT removed; `IpcChannel` still 86 (amendment (f)).**
- [ ] `--continue` / `--last` / `--fork-session` appear nowhere.
- [ ] `buildLaunch` touches no filesystem; `discoverSessionId` reads rollout headers only, never `session_index.jsonl`, and owns no timer or watcher.
- [ ] Descriptor kind and companion methods agree for each adapter; the honesty test at `:596` was **updated, not weakened**, and the `EXTENSION_METHODS` resume row at `:911` was removed rather than left to fail.
- [ ] Argv is asserted **exactly**, not by difference (Q5).
- [ ] No-resume argv byte-identical to HEAD, demonstrated for all four adapters.
- [ ] Credential + route + hooks survive a resume launch, demonstrated by test.
- [ ] `kimi.ts` and `opencode.ts` byte-identical to HEAD, and tested to ignore a `resume` field.
- [ ] `src/main/services/sessionManager.ts` byte-identical to HEAD.
- [ ] Nothing from amendments (b), (c) or (g) was implemented here.

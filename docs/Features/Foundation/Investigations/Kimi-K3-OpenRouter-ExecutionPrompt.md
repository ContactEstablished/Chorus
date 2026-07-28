# Investigation: why `moonshotai/kimi-k3` cannot complete a council turn — Execution Prompt

## Role

You are running a **narrow, self-contained investigation**. You are not building a feature and **you are not shipping a fix**. Your product is **evidence and a recommendation**.

Repo root: `C:\Projects\ContactEstablished\Chorus` · Platform: Windows 11, PowerShell 7 · Branch `main`.

Chorus is a local-first, BYOK Electron + Vue 3 + TypeScript desktop app for running several AI coding agents in parallel. Phase 3b shipped a **native council review** feature: point it at a brief `.md`, several models deliberate, a findings `.md` lands beside the brief. `moonshotai/kimi-k3` is one of four configured council members and **it has failed every single run it has ever participated in.**

---

## ⚠⚠ FIRST, AND IT IS NOT OPTIONAL: ANOTHER OPUS 5 SESSION IS WORKING IN THIS SAME FOLDER

**A second agent session is live in this repository right now, editing `docs/Features/Foundation/roadmap.md`.** This was not hypothetical when this prompt was written — a roadmap edit landed *underneath* the authoring session mid-write, and the two sets of changes are currently sitting uncommitted together in the working tree.

**Therefore these rules are hard, and breaking one corrupts someone else's work:**

1. **DO NOT modify ANY file under `src/`.** This investigation is **read-only** on the entire application source. If your conclusion needs a code change, you write it into your report **as a proposed diff in a fenced block** — you do not apply it.
2. **DO NOT modify `docs/Features/Foundation/roadmap.md`.** The other session owns it. If you produce something that belongs there, say so in your report and let a human route it.
3. **DO NOT `git add`, `git commit`, `git stash`, `git checkout`, `git restore`, or `git push`. Anything.** The working tree contains another session's uncommitted work. A commit from you would sweep it up; a stash or restore would destroy it. **If you believe something must be committed, stop and ask.**
4. **Every artifact you create goes under `_verify/kimi-k3/`**, which is gitignored. Nothing else. No new files in `docs/` except the one report named at the end, and that only if asked.
5. **If you boot the app at all, you MUST isolate it** — see the isolation section below. Two Electron instances fighting over `--remote-debugging-port=9222` and one SQLite file is the collision that will waste your session and possibly someone else's.

**Check the tree before you touch anything** and expect it to be dirty:

```powershell
git status --porcelain
```

**Dirt you did not create is someone else's work. Leave it exactly as you found it.**

---

## The symptom, stated precisely

`moonshotai/kimi-k3` has been a council member for three live runs against the real OpenRouter route. **It answered zero of them.** From the persisted transcripts (`council_messages`), not from memory:

| Run | Per-turn wall-clock deadline | kimi-k3's recorded turn |
|---|---|---|
| `6d234ecd-c18b-4cb5-bf7c-fbe39993d8a4` | 120 s (the transport default) | **`The response exceeded its time limit and was stopped.`** |
| `f105d716-109b-4019-aa99-45076d387010` | 10 min | **`The response exceeded its size limit and was stopped.`** |
| `87082401-9e0a-4387-b234-638deed648df` | 15 min | **`The response exceeded its size limit and was stopped.`** |

**⚠ THE TIME/SIZE SPLIT IS THE WHOLE DIAGNOSTIC AND IT IS WHY THIS IS WORTH A SESSION.** Given 120 s it ran out of time; **given ten times as long it then ran out of BYTES.** So it is not slow-to-first-token and it is not a one-off: it streams **for over two minutes AND emits more than 4 MB of SSE frames for a single answer**, every time.

Both refusals come from `src/main/services/apiSession.ts` — `timedOut` and `tooLarge` in its refusal vocabulary, bounded by `RESPONSE_TIMEOUT_MS` (overridden to 15 min by the council) and **`RESPONSE_CAP_BYTES = 4_000_000`**. Those bounds exist deliberately (roadmap decision **D63(e)**: *"nothing bounds the stream in bytes or time"*). **They are working. The question is what kimi is sending that trips them.**

**⚠ AND A SECOND SYMPTOM THAT MAY SHARE ONE CAUSE: kimi-k3 reports NO `usage` block at all.** Its `tokens_in` / `tokens_out` columns are NULL on every turn, so **its share of a run's spend is invisible to Chorus and appears only on OpenRouter's own billing page.** Chorus's reported run cost therefore **under-reports the truth** whenever kimi participates. Whether that is the same defect or a different one is **not established** — establishing it is in scope.

---

## The leading hypothesis, and the levers it points at

**kimi-k3 is a REASONING model, and Chorus is almost certainly paying for, waiting on, and then discarding its entire chain of thought.**

Already established, do not re-derive:

- **Roadmap finding F34 (Task 3b-1, measured):** a kimi-k3 probe capped at `max_tokens: 60` returned **exactly 60 output tokens with ZERO `delta.content` frames** — billed in full, answer empty. OpenRouter bills reasoning tokens **as output tokens**.
- **`createApiSession` yields only `delta.content` BY DESIGN** — a council transcript should carry the answer, not the reasoning. So reasoning text is invisible to the consumer *while still crossing the wire and counting against the byte cap*.
- **`createApiSession` builds its request body from exactly FOUR things:** `model`, `messages`, `stream`, and an optional `max_tokens`. **There is no channel for anything else.**

**⚠ AND HERE IS THE LEVER NOBODY HAS PULLED.** Read live from OpenRouter's free, unauthenticated `GET /api/v1/models` on 2026-07-26, `moonshotai/kimi-k3` declares these `supported_parameters`:

```
frequency_penalty · include_reasoning · max_tokens · presence_penalty
reasoning · reasoning_effort · response_format · stop
structured_outputs · tool_choice · tools
```

**`include_reasoning`, `reasoning` and `reasoning_effort` are all supported, and Chorus sends none of them.** So reasoning runs at the provider's default effort and is streamed in full. Also measured: `context_length` **1,048,576**, `max_completion_tokens` **UNSTATED** (OpenRouter publishes no output limit for this model at all), pricing **$3.00/M in · $15.00/M out** with an `input_cache_read` rate of $0.30/M.

**Your first job is to find out whether telling OpenRouter to suppress or bound the reasoning stream makes kimi-k3 a usable council member.** If it does, the fix is a transport parameter, not a bigger cap.

---

## Scope — what you are answering

1. **What is actually on the wire?** Capture kimi-k3's raw SSE stream for one realistic council-sized prompt. How many bytes, over how long, in what frame shapes, and what fraction is reasoning versus answer?
2. **Do the reasoning controls work, and which one is right?** Test `include_reasoning: false`, `reasoning: { exclude: true }`, `reasoning: { effort: 'low' }` and `reasoning: { max_tokens: N }` — whatever the current OpenRouter API actually documents. **Verify the parameter names against OpenRouter's own live documentation, not against training memory** (project rule D4). Report which combination produces a usable answer inside sane bounds.
3. **Why is there no `usage` block?** Is it absent, is it on a frame shape the parser skips, or is it lost when the stream is truncated by a cap? Note the third possibility carefully — **if usage only goes missing because the stream was killed, then fixing the stream fixes the accounting too**, and that would make it one defect rather than two.
4. **What is the cheapest correct change?** Rank the candidates honestly:
   - a transport parameter (needs a change to `apiSession.ts`'s body builder — a **real** design question, because that file is the app's single API primitive and D45(2) forbids forking it);
   - a bigger `RESPONSE_CAP_BYTES`;
   - a per-member parameter passthrough (`params_json` already stores arbitrary keys and the council deliberately sends only `max_tokens` today);
   - **dropping kimi-k3 from the council.**
5. **⚠ THE DECISION THIS MUST PRODUCE, STATED EITHER WAY.** Matthew would rather keep kimi-k3 — it is one of the models he would genuinely pick for a review — **but removal is an acceptable outcome if the evidence says so.** Do not manufacture a fix to avoid recommending removal, and do not recommend removal to avoid the work. **Say which, and show the measurement that decides it.**

### Explicit non-goals

- **NO changes under `src/`.** Propose diffs; do not apply them.
- **NO roadmap edits**, no new findings or decisions written into it — the other session owns that file.
- **NO council protocol changes**, no new IPC channel, no schema change, no migration, no new npm dependency.
- **NO full council runs unless you have exhausted cheaper instruments.** A four-model deliberation costs ~$0.80 and takes ~14 minutes; a single targeted probe costs cents and takes seconds. **The whole point of this session is to stop paying council prices for a transport question.**

---

## ⚠ Getting a key, without ever seeing one

You need a real OpenRouter credential to send a single request, and **the standing conditions on this repo are absolute**:

- **Never ask Matthew for a key's text, never read one from a file, never accept one in chat, never write one to disk, never print or log one.**
- **Never dump, echo or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`.** Select non-secret columns explicitly; prove blob stability with `length(encrypted_blob)` if you need to.
- **Do NOT press "Test key" in the UI** — it is a live billable call and nothing here needs one.

The credential you want is the profile labelled **`OR milestone key`** (provider `OpenRouter`), which is real and billable. Two viable routes, and you choose and justify:

- **(a) In-process.** A script run under `ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe` that decrypts through the app's own vault, **holds the plaintext in memory only**, and issues `fetch` calls directly — exactly what `createApiSession` does. This gives you full control of the request body, which is the entire point, since `apiSession.ts` cannot send a `reasoning` parameter today.
- **(b) Minted and capped.** Mint a small capped key via the app's own OpenRouter management-key client, use it, **revoke it in a `finally`** — the D64(2) discipline applied to your own harness. More faithful to production, more moving parts.

**⚠ Whichever you choose: prove decryptability EARLY and for FREE before spending anything.** `GET /api/v1/models` is free and unauthenticated; an *authenticated* model refresh is free and proves the blob decrypts. `_verify/3b-3/eval-vault-probe.js` is the existing precedent.

**⚠ F31 — if you copy the database anywhere, copy `Local State` beside it.** `safeStorage` blobs are wrapped with Chromium's OSCrypt key which lives in `<user-data-dir>/Local State`; copy `chorus.db` alone and **every pre-existing credential blob becomes undecryptable**, which will look like a vault bug and is not.

**Before you finish, run `npm run grep:secrets`.** It scans `_verify/` and is the only thing between one of your artifacts and a leaked key.

---

## Isolation, if you boot the app at all

**Prefer not to.** A standalone script answers every question in the Scope section and touches nothing shared.

If you genuinely need the running app:

- Use a **different debug port** — `--remote-debugging-port=9223`, never 9222.
- Use a **copied user-data-dir** (with `Local State`, per F31), never the real one, so no writes reach the live `chorus.db`.
- The real dev DB is `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`. **Read it if you must; write to a copy.** A dump quoting projects `985d547b…` / `f47ac10b…` is the real one; `a43b395d…` / `b684e96e…` is the scratch DB (roadmap finding F20).
- **Check for an already-running instance first** and do not kill it — it may be the other session's.

---

## Cost envelope

**Under $0.50, and you should land far below it.** kimi-k3 is $3/M in · $15/M out and **bills its reasoning as output**, so a probe with an unbounded reasoning budget is the expensive mistake this session exists to characterise.

- **Cap `max_tokens` on every probe** and start small.
- **Report actual cost**, read from the response's own `usage` block where one arrives — and say plainly when it does not, because that is one of the findings.
- **⚠ If you pass $0.30, stop and report before spending more.**
- A full council run is **~$0.80** and is a last resort, not a first instrument.

---

## Harness caveats — verified through 2026-07-26

- **electron-vite does NOT hot-restart the main process**; every main-process change needs a real cold boot. (You are not changing main-process code, so this mostly means: don't be fooled.)
- **`sqlite3` is not installed** — read the DB via `ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe` with better-sqlite3. `_verify/3b-4/dump-v11.js` is a current, non-secret-selecting dump script you can copy.
- **Known flake:** a dump script sometimes writes no file on its first invocation — retry once before diagnosing.
- **`ELECTRON_RUN_AS_NODE` scripts print nothing to a PowerShell console** (electron.exe is GUI-subsystem) — write results to a file.
- **Node 22 has global `fetch`**, so a plain `.mjs` script is enough for anything unauthenticated. `_verify/3b-4/probe-kimi-params.mjs` and `probe-frontier-roster.mjs` are working examples of the free `/models` probe.
- **Bash heredocs mangle Windows backslashes** — write JS files with the editor tool, not by shelling out a heredoc.
- **Other desktop apps steal foreground** (roadmap finding F29). Irrelevant unless you drive the UI — which you should not need to.

---

## Reporting requirements

Write your findings to **`_verify/kimi-k3/FINDINGS.md`** and summarise in chat. Report a status of exactly one of **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**, plus:

- **The raw stream characterisation** — bytes, duration, frame shapes, reasoning-versus-answer split, quoted from a real capture.
- **A parameter matrix**: which reasoning controls you sent, what each did to bytes, wall-clock, answer quality and cost. **Name the parameters you verified against OpenRouter's live docs**, and say which you could not verify.
- **A ruling on the missing `usage` block**, including whether it is caused by the truncation or independent of it.
- **The recommendation, one of: keep kimi-k3 with change X, or drop it** — with the measurement that decides it, and the strongest argument against your own recommendation.
- **Any proposed code change as an unapplied diff**, naming every file it would touch and flagging that `apiSession.ts` is the app's single API primitive (D45(2)) so a body-builder change is a design decision, not a tweak.
- **Actual cost**, with its denominator (probes run / usage reported / usage absent), and confirmation that "Test key" was never pressed.
- **Confirmation that you changed nothing under `src/`, edited no roadmap, staged nothing, and committed nothing**, plus the final `git status --porcelain` — which should show the other session's dirt **unchanged and untouched**.
- **`npm run grep:secrets` output.**

**Failure honesty:** if a probe is indeterminate, report it as indeterminate. An unproven claim is worse than an honest unknown, because it will be cited later as evidence. If the reasoning controls turn out not to be the cause, **say so plainly and early** rather than widening the search to justify the session.

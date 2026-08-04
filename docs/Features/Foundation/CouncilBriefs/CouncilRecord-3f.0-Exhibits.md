---
record_id: 7c1f4a2e-9d3b-4e51-8a6c-2f0b5d84e913
project: Chorus
phase: 3f
case: CR-3f.0 — The Exhibit Pack
opened: 2026-08-01
council_run: CR-3f.0 (Council Case 3f.0 — Exhibits)
status: REVIEW COMPLETE
---

# Council Record — CR-3f.0 — The Exhibit Pack

> **⚠ PROVENANCE, ADDED BY THE COORDINATOR 2026-08-01: THIS RUN WAS NOT CONDUCTED ON CHORUS'S NATIVE
> COUNCIL.** It is a **D6 external council** run, which is a legitimate path — but it must be
> labelled, because F38's whole native-vs-external comparison depends on knowing which mechanism
> produced a document. **Four independent confirmations, none of them inference:**
>
> 1. **`council_runs` holds no row for 2026-08-01.** The dev DB has **4 runs, the most recent
>    2026-07-28**. A native run writes a row before its first API call.
> 2. **Three of four models differ from the live roster.** `council_members` holds exactly D71's
>    four — `moonshotai/kimi-k3` · `z-ai/glm-5.2` · `qwen/qwen3-coder` · arbiter
>    `anthropic/claude-opus-5`. §2 below names `kimi-k2.7-code`, `qwen3.7-max` and `gpt-5.5`.
> 3. **§2's configuration fields do not exist in Chorus.** `grep` for `Max code chars`,
>    `Provider routing` and `Language hint` across `src/` returns **zero**. Chorus's council member
>    carries `{model, role, params_json}` and nothing resembling these.
> 4. **§2's `Request timeout 120 s` is the value D71 explicitly overrode.** `COUNCIL_TURN_TIMEOUT_MS`
>    is **15 minutes** (`councilService.ts:241`); under Chorus at 120 s, D71 measured **two reasoning
>    members aborting outright**. A native run could not have used 120 s.
>
> **⚠ AND IT MATERIALLY STRENGTHENS D111 RESOLUTION (b).** The harness that produced this record caps
> code input at **`Max code chars 100,000`** (§2), and the finding it produced was a **~100 KiB**
> pack cap — the council recommended, to within 2.4%, the largest pack its own harness could have
> shown it. **The measured ceiling on Chorus's actual roster is ~840 KiB**, set by `qwen3-coder`'s
> 262,144-token context window read live from OpenRouter on 2026-08-01. **Nothing else in this record
> is altered; the council's own text stands as filed.**

> **Full history of the council run.** This record captures every stage: the case as put to the
> council, the review configuration, launcher details, the independent member review output, the
> reconciled verdict, per-meeting concerns, decisions, arbitrations, and any proposals raised. It is
> a faithful transcript of what the council did, not a re-drafting of the case document.

---

## 1. Case submitted

**File:** `docs/Features/Foundation/CouncilBriefs/CouncilCase-3f.0-Exhibits.md`
**Case ID:** `7c1f4a2e-9d3b-4e51-8a6c-2f0b5d84e913`

The case is *CR-3f.0 — The Exhibit Pack: bounding and confining the first deliberate exfiltration
surface*. It is the first feature in the project that sends project source code to third-party APIs
by design. Summary of what was put before the council:

- **Context.** Chorus is a local-first Windows desktop app (Electron · Vue 3 · TypeScript · SQLite)
  running several AI coding agents in parallel panes. Its native multi-model Council Review feature
  (3–5 API members plus an arbiter, four phases) today can only reason about text pasted in by hand.
  The proposed "exhibits" change lets a case declare an `## Exhibits` section of paths/globs that are
  resolved pre-round into a numbered, path-labelled, line-numbered pack sent byte-identically to every
  member in the blind round.
- **Honest limit stated up front.** Exhibits do not exist yet; this council is deliberating about
  repository access without having any. The code and figures in the case were pasted in by hand and
  are the only evidence available. "Insufficient information" is a legitimate finding.

### Binding prior rulings (do not re-litigate)

1. Secrets never leave the vault in plaintext (OS credential store; env-var injection only).
2. Scrub on ingest, not on display (exact-value scrubber at the single ingest seam).
3. Refuse, never degrade (refuse the operation with an actionable message over a weaker guarantee).
4. Release-gate secret grep; stated limit — does not cover a prompt in flight, does not reach
   out-of-project files.
5. No number without its denominator (truncated/partial readings may not render as complete).
6. The deliberation protocol itself is closed (four phases, blind first round, preservation of
   dissent).

### Questions put to the council (six)

- **Q1** — Exhibit eligibility restricted to git-tracked files (`git ls-files`) instead of a
  deny-list of patterns (`.env*`, `*.pem`, `id_*`).
- **Q2** — On secret-shape match inside a resolved exhibit: refuse the entire run (path named) rather
  than drop the exhibit and disclose the drop.
- **Q3** — Bound the pack by a single byte budget on the assembled pack (post-resolution, pre-first-API)
  vs per-file cap / file count / estimated tokens. State the number.
- **Q4** — Cost threshold requiring explicit confirmation naming the estimate before any API call.
  State the threshold in USD given a measured $1.089 four-member baseline.
- **Q5** — Blind-round-only full text with index thereafter materially degrades critique/arbitration
  quality.
- **Q6** — Evidence parity is the right principle; the §2 argument is sound vs a rationalisation.

---

## 2. Council configuration

Verified via the council launcher before the run:

| Component | Value |
| --- | --- |
| API key present | ✅ True |
| Reviewers | Kimi → `moonshotai/kimi-k2.7-code` |
| | GLM → `z-ai/glm-5.2` |
| | Qwen → `qwen/qwen3.7-max` |
| Arbiter | `openai/gpt-5.5` |
| Provider routing | sort by throughput |
| Max code chars | 100,000 |
| Request timeout | 120 s |
| Language hint | `markdown` |

**Launcher.** Council review invoked with the full case text as the submitted code, task prompt
noting the security-sensitive nature of the feature (first design-time exfiltration of source to
third-party APIs), requesting verdict tokens, concrete numbers, and careful reasoning on security,
privacy bounds, and cost model.

---

## 3. Independent member review (blind positions)

The three reviewers (Kimi, GLM, Qwen) each deliberated independently and all completed. Their
collective findings, prior to arbitration, grouped by theme:

- **Exhibit eligibility (Q1).** All three flagged that `git ls-files` alone is insufficient — tracked
  files can still contain committed secrets, sensitive/generated/binary artifacts. Eligibility must be
  layered with secret/content scanning and defensive exclusions.
- **Later-round evidence (Q5).** Qwen overstates that quality is "necessarily destroyed"; Kimi and
  GLM agree that index-only later rounds degrade critique/arbitration if the full pack is not retained
  in model context.
- **Byte budget (Q3).** The assembled-pack cap is unset, leaving the exfiltration and cost surface
  unbounded at implementation time.
- **Cost confirmation (Q4).** The threshold is unset; high-cost runs could proceed without informed
  consent.
- **Preflight manifest (Kimi).** The proposal lacks a mandatory preflight exfiltration manifest for
  privacy review before source leaves the machine.

No reviewer abstained or failed; no verdict token was left unanswered.

---

## 4. Reconciled verdict (arbitration)

**VERDICT: REVISE** — Confidence 8/10

**Summary.** The pack concept is sound and evidence parity is endorsed, but the proposal is not ready
to ship as bounded. The council requires a **preflight exfiltration gate** layered onto eligibility,
an explicit byte budget, an explicit cost-confirmation threshold, and a guarantee about later-round
evidence availability.

### Findings, severity-ranked

**[HIGH] Exhibit eligibility cannot rely on `git ls-files` alone.**
Tracked files can still contain committed secrets or sensitive/generated/binary artifacts, so the git
allow-list must be layered with secret/content scanning and defensive exclusions.
*Fix:* Use tracked-files eligibility as the primary gate, then scan every resolved exhibit preflight
and refuse on secret matches; add filename/binary/oversize exclusions or explicit overrides.
*(Flagged by: Kimi, GLM, Qwen)*

**[HIGH] Later-round evidence availability is underspecified.**
Qwen overstates that quality is necessarily destroyed, but Kimi/GLM are right that index-only later
rounds degrade critique/arbitration if the full pack is not retained in model context.
*Fix:* Explicitly guarantee the round-0 exhibit text remains available and in context for all later
rounds, or deterministically reinject cited line ranges / refuse.
*(Flagged by: Kimi, GLM, Qwen)*

**[MEDIUM] The assembled-pack byte budget is still unset.**
Leaves the exfiltration and cost surface unbounded at implementation time.
*Fix:* Set a deterministic assembled-pack cap before shipment; prefer an initial conservative cap
around **100 KiB**, revisitable with measured context/cost data.
*(Flagged by: Kimi, GLM, Qwen)*

**[MEDIUM] The cost-confirmation threshold is still unset.**
High-cost runs could proceed without informed consent.
*Fix:* Require explicit preflight confirmation above **$2.00**, showing the estimate, model mix,
token/byte assumptions, destinations, and denominator.
*(Flagged by: Kimi, GLM, Qwen)*

**[MEDIUM] The proposal lacks a mandatory preflight exfiltration manifest.**
Privacy review of what will leave the machine is missing.
*Fix:* Show resolved files, byte total, truncation status, destination APIs, retention warning, and
estimated cost before any API call.
*(Flagged by: Kimi)*

---

## 5. Council positions on each question (decisions preserved with dissent)

> Per binding ruling 6 (closed protocol), dissent is preserved. The reconciled verdict is
> **REVISE**. The following maps each case question to the arbitration-adjusted position.

| Q | Token | Council position |
| --- | --- | --- |
| Q1 | **PARTIAL / REVISE** | Git-tracked eligibility is the right *primary* gate, but must be layered with preflight secret/content scanning and defensive exclusions. Git tracking alone is not a sufficient security boundary — tracked files can contain committed secrets. |
| Q2 | **AGREE** | Refuse the entire run, with the offending path named. Consistent with binding ruling 3 ("refuse, never degrade") and cleaner than drop-and-disclose: reveals surface without a lossy partial reading; also avoids the "denominator" hazard if a drop silently changes what members saw. |
| Q3 | **REVISE (set the number)** | Adopt a single assembled-pack byte budget checked post-resolution, pre-first-API. Set an initial conservative cap of **~100 KiB** until measured context/cost data justifies raising it. A deterministic cap is mandatory before shipment. |
| Q4 | **REVISE (set the threshold)** | Require explicit preflight confirmation above **$2.00**, naming the estimate, model mix, byte/token assumptions, destinations, and denominator. Given the $1.089 no-exhibit baseline, $2.00 catches exhibit-inflated runs while not interrupting ordinary ones. |
| Q5 | **QUALIFY** | Next-round quality *can* degrade if the full pack is not retained in member context. Guarantee round-0 exhibit text stays available/in-context for later rounds, or deterministically reinject cited line ranges; refuse rather than risk index-only reasoning on uncited material. |
| Q6 | **AGREE** | Evidence parity is sound and not a rationalisation. Computed disagreement vectors are only meaningful when every member judged the same evidence; the same-pack guarantee is materially superior to per-member retrieval. |

---

## 6. Concerns raised

1. **Exfiltration surface unbound at implementation time.** Without a deterministic cap, cost and
   exfiltration volume grow without bound. (Highest severity.)
2. **Tracked ≠ safe.** A tracked file can still leak a committed secret; git state is not a security
   control.
3. **Later-round blindness.** Cost-driven index-only later rounds may force members to reason without
   source evidence, weakening critique/arbitration.
4. **Informed consent for cost.** No explicit consent gate means a user may not know what will be sent
   or what it will cost.
5. **No preflight manifest.** Nothing today forces a reviewable inventory of exactly which files,
   bytes, and destinations are involved before any network call.
6. **Necessity overstatement (dissent observed).** One member (Qwen) overclaimed that round-index
   quality is *necessarily* destroyed; the council reconciled this to "can degrade if evidence is not
   retained," preserving the underlying concern without the overstatement.

---

## 7. Decisions taken by the council

- **Adopt the preflight exfiltration gate as the top priority.** Tracked-file eligibility +
  secret scanning/refusal + an explicit manifest before any network call.
- **Commit to a deterministic assembled-pack byte cap before shipment** (~100 KiB initial).
- **Commit to an explicit cost-confirmation threshold before shipment** (> $2.00).
- **Require evidence continuity in later rounds** (retain round-0 text in context, or reinject cited
  ranges, or refuse).
- **Keep "refuse, never degrade"** (binding ruling 3) as the governing behaviour for the refuse-the-
  whole-run decision on secret matches (Q2).
- **Preserve evidence parity (Q6)** as the retained design principle, not a short-cut.

---

## 8. Arbitrations performed

1. **Q5 severity.** Reconciled an overstatement (Qwen: quality *necessarily destroyed*) into the
   sounder claim that it *can degrade if the full pack is not retained in context*, keeping the
   underlying concern intact while improving precision.
2. **Eligibility model (Q1).** Union of all three reviewers' positions: git allow-list as primary
   gate is accepted, but only as one layer of a defense-in-depth preflight gate, not as the whole
   answer.
3. **Unset numbers (Q3, Q4).** Both intentionally-unset magnitudes were reconciled into concrete
   initial defaults (100 KiB byte budget; $2.00 cost threshold), each with an explicit derivation and
   both flagged as revisitable with measured data.

---

## 9. Proposals raised

- **P1 (top priority).** Implement a preflight exfiltration gate: (a) git-tracked eligibility,
  (b) exact-value + secret-shape scanning of every resolved exhibit with whole-run refusal on match,
  (c) a mandatory preflight manifest (resolved files, byte totals, truncation status, destinations,
  retention warning, estimated cost) shown before any API call.
- **P2.** Set the initial assembled-pack byte budget to ~100 KiB, revisited after measuring real
  context/cost.
- **P3.** Set the explicit cost-confirmation threshold to $2.00 (est.) and require the estimate plus
  model mix and assumptions to be named.
- **P4.** Guarantee round-0 exhibit text remains available/in-context through critique and arbitration,
  or deterministically reinject cited line ranges; refuse rather than reason on uncited material.
- **P5.** Keep truncation explicit and non-silent (already required) and surface truncation status in
  the preflight manifest and findings document.

---

## 10. Status and next action

- **Council status:** REVIEW COMPLETE — verdict **REVISE** (confidence 8).
- **Required before this feature ships:** set the three unset bounds (eligibility layering, byte
  budget, cost threshold) and add the preflight manifest + later-round evidence continuity guarantee.
- The deliberate design (same pre-resolved pack, evidence parity) is retained.

---

*This record is the authoritative transcript of the CR-3f.0 council run and preserves all member
findings, the reconciled verdict, arbitrations, concerns, decisions, and proposals without loss or
silent synthesis.*

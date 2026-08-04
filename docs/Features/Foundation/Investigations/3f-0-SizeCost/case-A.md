---
case_id: 3a91c6d4-77e2-4b18-9f05-6ce1b0a2d7f4
project: Chorus
phase: 3f
opened: 2026-08-01
purpose: size/cost instrument — the SAME case is run at four pack sizes
---

# CR-3f.1 — Where the Docket's truth lives

> **⚠ ANSWER THE QUESTIONS IN SECTION 4. DO NOT REVIEW THIS DOCUMENT.** This is a case put to the
> council, not a design document submitted for critique. Do not comment on its structure, length,
> completeness or wording. Every question in §4 requires a `Qn: AGREE | DISAGREE | QUALIFY` verdict
> token on its own line, followed by your reasoning.
>
> **⚠ KEEP EACH ANSWER UNDER 400 WORDS.** This case is also a measurement instrument: it is run
> several times with different amounts of source code attached, and the comparison is only valid if
> answer length stays roughly constant. Be decisive rather than exhaustive.

---

## 1. Context

**Chorus** is a local-first Windows desktop app (Electron · Vue 3 · TypeScript · SQLite) for running
several AI coding agents in parallel terminal panes. It has a native multi-model Council Review
feature — you are it.

A feature now being designed gives the council a **per-project history**, called the **Docket**. The
design so far:

- A **Case** is a markdown document with mandatory headings, stored **in the project's own
  repository** at `docs/council/<slug>/case.md`, and therefore committed to git and shared with
  whoever clones the repo.
- Each **Run** of that case writes `runs/<timestamp>/findings.md` beneath it.
- The **database** separately records every run: cost, token counts, timings, and the full
  transcript of what each member said.
- A case carries a `case_id` UUID in its own frontmatter, so its identity survives a folder rename
  or a clone onto another machine.

**⚠ THE PROBLEM THIS CASE EXISTS TO SETTLE: there are now two stores, and they can disagree.** The
database knows about runs; the repository holds the documents. A case folder can arrive on a machine
by `git pull` with **no database row behind it**. A database row can survive a case folder being
deleted by hand. Neither store is wrong; they answer different questions.

---

## 2. The three candidate positions

**(A) The database is the Docket.** The view lists rows from the `council_runs` table. A case folder
with no run row is simply not shown. Simple, fast, and the view can never show something it has no
metadata for — but a colleague's case, pulled from git, is invisible until someone runs it locally.

**(B) The filesystem is the Docket.** The view scans `docs/council/*/case.md` and shows every case
it finds, attaching run metadata from the database where a row exists. Nothing on disk is ever
hidden — but the view now depends on a directory scan on every open, and a case that has never run
has no cost, no verdict and no transcript to show.

**(C) Reconcile both, and label the difference.** The view shows the union: cases from disk, runs
from the database, and any case with no local run row is rendered in a distinct "never run here"
state. Most honest, most code, and it introduces a third thing the user must understand.

---

## 3. Binding prior rulings — constraints on your answer, not open questions

These are settled decisions in this project. **Do not re-litigate them.** An answer that requires
overturning one of them is out of scope; say so and answer within the constraint.

1. **Cases live in the repository.** Storing them in private application data was considered and
   rejected: the findings must be readable by the coding agents working in that repo.
2. **Transcripts are kept indefinitely**, with the growth arithmetic done — roughly 38 MB/year at a
   pessimistic four runs per week. A background purge was explicitly declined.
3. **No number without its denominator.** A count derived from partial data must carry the
   denominator that makes it honest.
4. **Refuse, never degrade.** Where a property cannot be guaranteed, refuse with an actionable
   message rather than proceeding with a weaker guarantee.
5. **Deleting is two actions** — "Remove from Docket" purges database rows and keeps the files;
   "Delete case" also removes the folder, behind a confirmation naming the path.
6. **The deliberation protocol itself is closed.** Four phases, blind first round, unconditional
   preservation of dissent.

---

## 4. Questions — answer each one; do not review this document

Each answer must begin with a verdict token on its own line, exactly in the form `Q1: AGREE`,
`Q1: DISAGREE` or `Q1: QUALIFY`, followed by your reasoning in prose. Use **QUALIFY** when you
support the proposal only under a condition you must then state. **Keep each answer under 400
words.**

1. Position (C) is correct: the Docket must show the union of both stores and render a case with no
   local run row in a visibly distinct state, rather than hiding it or inventing metadata for it.

2. The `case_id` UUID in the case's frontmatter should be the sole identity used to join a case to
   its runs, and the folder path should never be used as a fallback key even when the frontmatter is
   missing or malformed.

3. A case folder that is present on disk but whose `case_id` matches no database row should be
   openable and re-runnable from the Docket, rather than being read-only until someone runs it.

4. When the database holds a run whose case folder has been deleted from disk, that run should
   remain visible in the Docket as an orphan with its cost and transcript intact, rather than being
   hidden or purged automatically.

5. The Docket view should perform its directory scan **once per project selection** and cache the
   result for the session, rather than re-scanning every time the view is opened.

6. Two different machines running the same case will produce different `runs/<timestamp>/` folders
   that git will merge without conflict, and this is acceptable — the alternative of a single
   canonical findings file per case would be worse.

---

## 5. What a useful answer looks like

- A verdict token for every question, on its own line, before the prose.
- Where you disagree, say what you would do **instead**, concretely enough to build.
- Where you believe a question rests on a false premise, say which premise and why — but check §3
  first, because several premises are settled rulings rather than assumptions.
- **Under 400 words per answer.** Decisiveness is worth more here than coverage.

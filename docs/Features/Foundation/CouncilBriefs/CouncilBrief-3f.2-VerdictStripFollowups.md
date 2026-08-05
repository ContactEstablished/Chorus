# Council Brief 3f.2 — Follow-ups left open by the Verdict strip

## 1. Your task

**Answer the numbered questions in section 4. Do NOT review, critique or edit
this document.** This brief is the question paper, not the subject.

Each question proposes a change. Rule on the proposal itself.

## 2. Context — everything you need is here

Chorus is a Windows desktop app that runs several AI coding agents in parallel
terminal panes. It can also convene a **council**: several models answer a brief
of numbered questions blind, critique each other anonymised, and one **arbiter**
rules and writes findings.

Two features shipped this week:

- **The Docket** — a per-project history of council runs. Each row shows the
  brief name, status, duration, turn and token counts, and a per-run cost.
- **The Verdict strip** — per question, what the arbiter ruled beside what the
  members concluded. Both are *derived on read* from stored turns; nothing is
  cached and no database column was added.

Three measured facts that bear on the questions:

- **F42:** the stored per-run cost figure under-reports the real provider bill by
  **37–60%**, and the factor is not constant. Token counts, by contrast, are
  accurate. Costs are therefore displayed as a floor (`at least $1.09`) and no
  project-level total is shown.
- Deriving the Verdict strip for a five-run Docket measures **7 ms**, including
  reading each brief from disk.
- The members' consensus vocabulary has five states: `agreed`, `qualified`,
  `split`, `disagreed`, `not-measured`. **`disagreed` means every member answered
  DISAGREE — unanimous opposition.** Members disagreeing *with each other* is
  `split`. Both appear next to each other in the same strip.

## 3. Constraints — binding, not open

- No database migration is available; the next migration slot is claimed by
  another feature already in flight.
- The council cannot read the repository. Answer from this document alone.

## 4. Questions

1. Rename the consensus state `disagreed` to `unanimous-against`, leaving the
   other four names unchanged, on the grounds that `disagreed` sitting beside
   `agreed` reads as "the members disagreed with each other" when that state is
   actually named `split`. The rename would change a label already written into
   every findings document produced so far.
2. Add a cache for the derived Verdict strip, keyed by run, invalidated when the
   brief file changes on disk, given the 7 ms measurement above.
3. Show a project-level cost total on the Docket by summing the per-run figures,
   labelled "at least $X", before the F42 under-reporting is fixed.
4. Re-probe installed agent CLIs when the settings screen opens, in addition to
   the launch dialog which already does it. The probe starts four processes and
   takes roughly 500 ms.
5. Set the maximum size of a repository-file pack that Chorus may send to third
   party model APIs to 256 KiB per council run.

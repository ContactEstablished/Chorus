# Task 11-3 integration verification — 2026-09-20

The scoped artifact/staging/promotion gate passed. Full application boot reconciliation and packaged evaluations remain Task 11-5 requirements.

Native Electron 43.1.1 / Node 24.18.0 / SQLite 3.53.1 report at 21:38:28 UTC: **40 storage, 59 coordinator, 46 workspace and 70 integration assertions passed**. Evidence: `%TEMP%/chorus-team-storage-FbzWgH/report.json`. Disposable repositories and databases only.

Real Git coverage includes both approval policies, artifact and exact prepared review prerequisites, user-only approval/CAS/idempotency, dirty integration refusal and retained work, new preparation identity, ff-only promotion, separate integrated verification, conflicting artifacts, source preservation, attributed configuration exclusion/restoration, submodule refusal and clean lead checkpointing before dispatch. Fault injection covers objects before intent, ref before prepared metadata, applying intent before Git, and Git success before database finalization. Ambiguous applying results block the run. Fixture-only repairs between independent injected failures are not production recovery evidence.

Full suite: 103 files / 3,404 tests passed. Both typechecks and production build passed before Task 11-4 edits. Logs: ignored `_verify/phase11-tests-resume.log`, `phase11-typecheck-resume.log`, `phase11-build-resume.log`.

Upstream contract amendments: source paths/diff identity in review evidence; immutable latest-review lookup; workspace subscription/settlement hooks; async clean integration checkpoint before attempt reservation; rejected superseded preparations; applying failure blocks the run. Main composition must supply a cooperative lead write lease and authenticated lead authorization. These are not OS write locks.

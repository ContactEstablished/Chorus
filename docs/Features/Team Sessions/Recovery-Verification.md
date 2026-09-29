# Phase 11 recovery verification — 2026-09-20

`TeamRecoveryCore` classifies boot outcomes without effects. `TeamRecoveryService` has no credential, lease, process-spawn, prompt or Git-mutation dependency. The production composition supplies identity-checked orphan retirement. Boot ordering is storage/migration → Team restore exclusions → worktree reconcile → Team recovery → eligible ordinary restore.

## Real process restart fixture

`node scripts/verify-team-recovery.mjs` builds a native Electron verifier. Each scenario starts a seed process, performs real SQLite/Git effects, exits with code 73 without runtime/storage shutdown, and starts a separate recovery process. It asserts native process cessation where applicable, unchanged source files/refs, no duplicate tasks/attempts, no credential resolution or new lead/helper launch, and an identical snapshot after a second reconcile. Evidence is retained outside the project in disposable directories.

Latest recorded run: **278 assertions / 22 scenarios passed**, `%TEMP%/chorus-team-recovery-fFurJc/report.json`, 2026-09-21 00:39:04 UTC. Every scenario directly asserts an empty in-memory lease map in addition to zero credential resolution and zero process launches at boot.

| Interruption or fault | Proven result |
|---|---|
| Run persisted, no workspace | Blocked with retained launch history |
| Managed workspace created before completion event | Exact repository/branch/clean base proves metadata completion; paused without replaying Git |
| Workspace ready, no lead | Paused, generation invalidated |
| Helper root and descendants survive process exit | Durable retirement intent precedes native identity-checked stop; interrupted, confirmed, counted attempt retained |
| Root creation identity mismatch | No process signaled by recovery; unknown writer blocks reuse; fixture later cleans up using its separately retained correct identities |
| Dirty integration workspace | File preserved; paused with explicit Recover guidance |
| Missing/moved integration workspace | Blocked; moved files preserved |
| Artifact ref published before metadata | Exact reservation, complete object journal, ref, commit parent/tree/message and manifest prove immutable metadata publication |
| Prepared ref published before metadata | Exact intent/ref/object proof restores prepared metadata and diff evidence; no apply |
| Applying intent, HEAD still at expected base | Interrupted without reapplying |
| Branch promoted, database not finalized | Exact clean result reconciles applied once; task returns to awaiting integrated review |
| Unknown private ref | Ref preserved; run blocked |
| Corrupt run JSON | No boot effects; explicit unavailable-history blocker |
| Lead spawned before bridge readiness | Real owned orphan stopped; lead pointer retained without relaunch |
| Attempt reserved before helper workspace | Interrupted counted attempt; no duplicate task or automatic retry |
| Injected native inspection access denial | Actual live orphan left untouched and blocked; fixture restores inspection for identity-checked cleanup |
| Capture reserved before objects | Helper output retained; no artifact publication or replay |
| Capture objects written before private ref | Commit object and helper output retained; missing publication proof remains blocked |
| Exact approval accepted before apply | Decision and prepared tuple retained; integration branch stays at its original base |
| Selected credential deleted or rotated; provider route changed | Real provider/profile database mutations survive restart; configuration remains immutable; zero boot decrypt, lease or launch |

The verifier found and corrected a real stop race: a descendant could exit while the native Stop-Process command was iterating, causing an error despite cessation. Final creation/executable-identity inspection now decides the result. Reused or inaccessible identities remain uncertain. The first verifier failures also included a fixture foreign-key ordering error and use of Electron's process.exit without returning; both were corrected, and those directories are retained as failures.

## Other hardening evidence

The native helper verifier passed 40 assertions at `%TEMP%/chorus-team-process-QqlEnG`; its summary is `_verify/phase11-final-process.log` and individual scenario JSON files live in that directory. It covers cancellation/timeout/structured result/unknown identity and durable cancellation-intent failure. The final implementation also rejects older processes whose recorded parent PID has been recycled and revalidates identities after descendant discovery. Native SQLite/runtime/workspace/integration verification passed 46/67/46/70 assertions at `%TEMP%/chorus-team-storage-Yd5wmX/report.json`.

Conversation proof tests require a Claude conversation ID assigned by the run's launch journal and a record naming the exact integration cwd, or a Codex rollout carrying both the exact conversation ID and Chorus session stamp/cwd. Missing, malformed or foreign pointers use a visibly labeled fresh conversation with retained-task handoff. The old pointer is journaled before a successful fresh launch replaces it. Shared lead-stop promises prevent concurrent Resume requests from signaling a replacement process under the reused session ID. Resume/Recover preflight refuses dirty or ambiguous replacement requests before stopping the existing lead.

The final full suite passed 3,426 tests in 108 files. Focused IPC regressions also establish that a version change while recovery inspection is awaiting cannot stop the lead, and unconfirmed cessation cannot reach the lifecycle replacement path. After Bitdefender interrupted the packaged test processes, a final identity-based inspection found zero surviving or uncertain processes in the six recorded lead/helper groups; see `_verify/phase11-fixture-cessation.json` and the separate application report.

## Open gate

This is substantial recovery evidence, not complete Task 11-5 acceptance. Later development-app runs passed actual quit during helper execution, integration preparation and apply, plus real recovery-only interaction; all 18 evaluation executions are now recorded with a two-build amendment. See [Application-Verification.md](Application-Verification.md) and [Evaluation-Report.md](Evaluation-Report.md). Actual OS access denial remains simulated at the inspection boundary, credential rotation stubs the final replacement launch, and final packaged verification remains blocked by Bitdefender. Capture reservations without a published ref or sufficient immutable metadata stay blocked; recovery does not synthesize proof or replay their Git effects. Corrupt history is reported per run alongside healthy history; the renderer removes stale actionable snapshots for unavailable runs.

## Live cessation follow-up — continuation window

A real development-app workflow exposed a terminal helper whose process inspection was uncertain at settlement. Later native inspection found all recorded identities gone, but the durable unknown state held its slot indefinitely. The exact transient inspection failure was not captured; it is not attributed to antivirus without evidence.

HelperProcess now retries inspection during its bounded settlement window and retains a read-only follow-up poll after an unknown outcome. Positive creation/executable identity evidence publishes a durable cessation event. The failed result, artifact absence and counted attempt remain unchanged; a revision is explicit. Pause/Stop can drain after that event. Uncertain/reused identities remain blocked, and explicit retirement records intent before signaling. Disposal cancels follow-up timers.

Native process verification passed **46 assertions** at `%TEMP%/chorus-team-process-fKrMHh`, including a real detached descendant that outlives its root and later exits naturally. Native SQLite/runtime verification passed **46 storage / 81 runtime / 46 workspace / 70 integration assertions** at `%TEMP%/chorus-team-storage-EveVDt/report.json`; the new runtime cases prove both Pause and Stop drain after late confirmation without result promotion, duplicate events or an extra attempt. Initial descendant fixtures were corrected to use a detached process, since Windows terminated their shared-console child with the parent; those failed fixture directories remain retained.

Explicit Resume checks now reject deleted credentials and changed routes before issuing a lease or changing generation. Rotation constructs a new generation lease containing the current fingerprint and selected profile identity. Native CLI compatibility, real stored provider/profile data and production lease construction are exercised; only the final lead-launch boundary is stubbed in the rotation case. No credential is decrypted and no actual CLI is launched by those resume checks.

## Durable active identities and retired descendants

The fifth comparative execution completed its code acceptance but failed baseline cleanup: a previously observed descendant PID had exited and was later reused by an unrelated browser. No unrelated process was signaled. That failed cleanup remains in the original report.

After an unambiguous native observation, helper and lead owners now persist the active descendant set before retiring identities already proven absent. The root identity remains until whole-tree cessation; an uncertain or reused identity that has not already been retired still blocks. Historical events retain retired identities. Helpers publish newly observed descendants while running, closing the previous crash window before terminal outcome persistence. If persistence fails, the in-memory ownership set is not advanced.

The current native process verifier passed **51 assertions**, `%TEMP%/chorus-team-process-m8rY0y`. Native SQLite/runtime/workspace/integration verification passed **46 / 90 / 46 / 70 assertions**, `%TEMP%/chorus-team-storage-ah7hG9/report.json`, at 01:01:37 UTC. These include active/retired descendant persistence, forged root rejection, late cessation publication and retry after durable-write failure. The full Vitest suite again passed **3,426 tests in 108 files** after this correction. The remaining comparison executions use the corrected bundle under a recorded protocol amendment; this is not a single-build performance benchmark.

The final native process run expanded to **55 assertions**, `%TEMP%/chorus-team-process-j6onRf`. Disposing a still-live helper with unverified identity now clears polling and execution timers, and a later process exit cannot restart its reconciliation interval. Unknown cessation remains unknown; the fixture uses its separately retained proven identity for cleanup. The verifier checks both absence of post-disposal polling/deadline calls and absence of restarted polling after exit. These later timer changes are outside the frozen comparison bundles.

Restart recovery was rerun after the durable identity change: **278 assertions / 22 scenarios**, `%TEMP%/chorus-team-recovery-6fNTxl/report.json`, 01:08:02 UTC.

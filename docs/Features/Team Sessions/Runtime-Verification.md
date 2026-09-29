# Task 11-2 execution and downstream handoff

Verified 2026-09-20 against the working tree based on `21580bda`. Task 11-2 is complete as an injected main-process runtime foundation. This is the historical Task 11-2 gate. Team Sessions is now wired into the application; see [current progress](Implementation-Progress.md), [application evidence](Application-Verification.md), and [recovery evidence](Recovery-Verification.md) for later work and the still-open release gate.

## Implemented contracts

- Strict shared Zod contracts, pure lifecycle/dispatch rules, bounded attempts/concurrency, durable idempotency and original acknowledgments.
- Seven restrictive team tables on StorageService's existing connection. Migration 25 was allocated after checking the working registry, seven Git refs (maximum 24), and an isolated copied database (24). No installed database was modified by verification.
- TeamStorage uses validated snapshots with checked indexed columns, synchronous immediate transactions, atomic state/events, immutable attempt artifacts and integration preparations, capture reservation/object/publication journals, and workspace ownership journals.
- SessionManager owns helpers in a separate native pipe-process map. Ordinary PTY paths remain separate. Restore exclusion is checked before ordinary restore selection and again before launch.
- Loopback broker authenticates before domain dispatch, validates the exact Host and bearer token, rejects browser Origin requests, bounds requests/connections/body size, and revokes active requests with leases.
- TeamService owns generation/credential fences, queue reservations, preparation and execution timeouts, analysis review, explicit revisions, Pause/Stop/Resume/Recover, passive paused restoration, and bounded asynchronous shutdown. Missing Git review/integration implementations fail closed.
- Helper cancellation records intent before signaling, tracks Windows PID plus creation and executable identity, and retains unknown cessation as a blocker. Selected credentials are environment-only; ambient credentials are excluded, output is scrubbed across fragments, and parser/secret buffers are released after completion.

## Actual verification

| Check | Result |
|---|---|
| `npm run typecheck` | Passed, node and renderer, after runtime hardening |
| `npm test` | Task-11-2 gate: 101 files, 3,394 tests passed; latest with partial 11-3: 103 files, 3,402 tests passed |
| `node scripts/verify-team-storage.mjs` | 40 native storage assertions and 59 coordinator assertions passed |
| Native runtime | Electron 43.1.1, Node 24.18.0, SQLite 3.53.1 |
| `node scripts/verify-team-process.mjs` | 40 native process assertions passed on Node 22.14.0 |
| `node scripts/verify-team-compatibility.mjs --fixture` | 57 facade assertions passed |
| `npm run grep:secrets` | Passed |
| `npm run build` | Passed |

Retained native evidence: `%TEMP%/chorus-team-storage-Tq80oa`, `%TEMP%/chorus-team-process-xJNw1Q`, `%TEMP%/chorus-team-compat-7Sbuif`. Storage verification covers fresh/24-to-25 migration, rollback, scoped uniqueness/FKs, reopen, corruption, capture publication order/immutability, and workspace reservation/replay/completion. Coordinator verification covers concurrent reservations, three-attempt exhaustion, Pause during decryption, credential rotation, cancellation during preparation and result validation, post-spawn revocation, recovery-only scope, generation invalidation, active/queued shutdown, launch-versus-shutdown, and zero team effects at boot. Native process verification includes descendant writers, unknown liveness, split secrets, malformed output, timeouts and final spawn fences.

The real-model Task 11-1 evidence remains in [Compatibility-Report.md](Compatibility-Report.md). This runtime verifier uses injected model/workspace boundaries and real SQLite; it does not claim to prove Git integration or production app composition.

## Ownership handoffs

11-1 correction: HelperExecutionInput now carries independent context and acceptance criteria, in addition to brief. Each text field retains its own size limit and instruction bytes. No unverified CLI/auth combination was enabled.

11-3 consumes `TeamServiceDependencies.workspace`, TeamStorage's scoped `command` transaction facade, `reserveWorkspace`/`completeWorkspace`, `reserveCapture`/`recordCaptureObjects`/`publishArtifact`, and `unfinishedOperations`. Reviews belong in append-only command events; integration records carry the exact approval tuple. Every reprepare needs a new integration/preparation identity. Workspace methods must re-read generation/state after awaits and before Git effects. The service must not open another database connection. Real Git effects and the workspace service are not supplied by 11-2.

11-4 must supply current installed-version/project/credential validation, production workspace/executor/lead wiring, broker lease callbacks, external lead configuration, typed IPC and renderer views. It must bind SessionManager restore exclusion before ordinary restoration; use a detected native Node executable for the packaged facade; and await TeamService.shutdown plus SessionManager.disposeHelpers before closing storage. If shutdown reports incomplete, retain its blockers for recovery. The existing synchronous SessionManager.dispose is not sufficient as the application's asynchronous shutdown gate.

11-5 owns evidence-based Git recovery, destructive CRUD guards, fault-injected full app recovery, packaged runtime verification and all 18 comparative runs. Process identity tracking is conservative evidence for known owned processes, not an OS sandbox or proof against arbitrary unobserved local writers. No savings claim is made.

All pre-existing staged/unstaged/untracked work remains preserved. `git diff --check` still reports the pre-existing TerminalPane font-line whitespace; no unrelated cleanup was applied.

Task-11-3 upstream correction: `unfinishedOperations` now recognizes the durable `capture-no-changes` event as a completed capture reservation, without inventing an artifact or applied change. Resume also explicitly rejects ordinary retained dirt until recovery resolves it. The native upgrade verifier was corrected to read the project from `getOrCreateProject`'s `{ project, reactivatedFrom }` return; its earlier undefined-to-undefined project comparison was not valid preservation evidence. The corrected native run verifies the real project ID survives the upgrade.

# Independent helpers and automatic integration

September 22, 2026. Supersedes the human approval workflow and one-helper default in the earlier Team review work.

New Team launches default to one lead and two helper slots, with two distinct roster identities even when both helpers use the same model. The lead reviews and applies results without a human approval step. The user views applied outputs and requests corrections afterward.

The lead is instructed to divide work by complete deliverable and file ownership. Geometry and Earth Science can run independently; so can a Geometry practice test and Geometry cheat sheet. Each helper receives a self-contained brief with content requirements, accessible references, exact output and private build/test paths, supported checks, conventions and acceptance criteria. Shared templates, renderers and drivers belong to the lead and are prepared before dispatch.

## Execution rules

- Declared writable paths determine whether code tasks can run together. Matching files and parent/child directories overlap, with Windows case/separator normalization. Missing or wildcard scopes are treated conservatively. Read-only reference files do not belong in writable paths.
- The scheduler skips conflicting queued work while allowing independent work to start. Existing work retains its scope through review and integration. A queued task explains that it is waiting on overlapping or unspecified files.
- File scopes are coordination declarations, not OS sandbox enforcement. Helper instructions require compliance; the lead still inspects artifacts for unintended changes.
- Helper execution remains parallel. Preparation and application are coordinated one result at a time. A second preparation against the same current baseline returns a retryable `INTEGRATION_BUSY` error without consuming another attempt or creating another integration.
- After the first result is applied, the second original artifact can be prepared against the new HEAD. An interrupted integration can be prepared again from its accepted artifact without commissioning a copy task.
- Exact artifact/prepared reviews, clean-workspace checks, process ownership and final integrated verification remain required. Human approval no longer gates application, including for legacy `ask` records.
- Startup releases retained `awaiting-approval` task/integration states after recovery reconciliation. This changes no Git content and starts no helpers. Historic run configurations and decision events remain intact. New launches always use `lead-integrates`, including launches from older presets.
- The old renderer approval endpoint reports that approval has been removed. The viewer offers before/after saved-file previews and a Done button; it makes no execution decision.

## Verification

- `npm run build` passes, including both TypeScript checks.
- `npm test`: 110 files, 3,439 tests passed.
- Native verification: 46 storage, 103 runtime, 46 workspace, 82 integration and 25 member assertions passed.
- Integration fixtures check that an independent second artifact is retained while the first preparation is pending, then applies on the new baseline without human approval or another helper attempt. Both files survive.
- Runtime fixtures check idempotent retirement of retained approval waits without applying output or launching another helper.
- Electron UI verification covers two default helper identities, concurrency two, automatic integration configuration, no approval controls, HTML/PDF previews, script isolation and narrow layout.

Source and build changes do not replace an already-running installed application. Existing teams keep their saved roster/concurrency; two helpers is the new-launch default. Revised lead instructions take effect on the next lead launch or replacement. Output previews show saved applied versions, which may differ from subsequent lead edits.

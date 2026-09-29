# Team review usability and Talon run findings

The approval UI and one-helper default described below were superseded on September 22 by [independent helpers and automatic integration](Independent-Helpers-and-Automatic-Integration.md). The run findings remain historical evidence.

Observed September 21, 2026, by read-only inspection of the packaged application's retained Team records. The active run was not modified. Counts describe the inspected snapshot, not a completed benchmark.

## Observed overhead

The Talon 9th Grade - Study run had 20 tasks and 22 helper attempts: 13 succeeded, six were marked permission-blocked, and three failed. Recorded execution totaled approximately 184.7 helper-minutes; parallel execution overlaps, so this is not wall-clock duration.

At least one helper explicitly reported that the external Documents reference folder was denied. Several other permission-blocked attempts reported producing files and passing tests. The current process policy treats any reported permission blockage as an unsuccessful attempt even if a later result reports success. Later tasks explicitly carried retained files into new outputs. This is evidence of access and coordination overhead, not proof that a particular model was slow.

Each code result also goes through artifact review, preparation, prepared review, user approval under the ask policy, application, and integrated verification. Many small or dependent tasks multiply those steps. A one-helper default and better lead instructions reduce the incentive to over-delegate; speed improvement still needs measurement on a comparable weekly run.

## Implemented changes

- Compact Team strip with separate review and attention actions; task history, configuration, and raw records stay collapsed.
- Dedicated review dialog with a short lead explanation, changed files, before/after views, PDF pages, images, static HTML, and text. Approval remains bound to the existing versioned integration record.
- Files are read from immutable Git blobs, not current worktree files. The review endpoint fetches matching prepared-review evidence directly, independent of the first 200 history events.
- Approve is gated by viewing a proposed file or complete source diff and explicitly confirming review. Deny remains available without successful preview loading.
- Permission/protocol reasons are persisted immediately on attempts and current tasks, outside the activity log's display limit. Permission reasons survive terminal settlement.
- One concurrent helper by default for new configurations. Existing stored run/preset settings remain explicit and unchanged. Lead instructions favor substantial independent tasks, accessible committed inputs, and concise user-facing review explanations.
- PDF rendering code loads when the review dialog opens.

## Limits

HTML previews are static and block scripts and external resources. They cannot verify interactive behavior or reproduce layouts dependent on external assets. PDF previews show rendered pages, not PDF actions or forms. Unsupported binary files, symlinks, and files above 8 MiB show an explicit unavailable message. Source diffs can be truncated and are labelled; individual supported file previews remain available.

These changes do not broaden helper permissions or reinterpret historical failed attempts as successes. Existing generic blocker records remain generic; detailed reasons are captured for future events. Current lead sessions receive revised orchestration instructions only when launched or replaced. The installed application has not been replaced by this source change.

## Validation

- `npm run build` (includes both TypeScript checks).
- `npm test`: 110 files, 3,436 tests passed.
- `node scripts/verify-team-storage.mjs`: 46 storage, 98 runtime, 46 workspace, 70 integration, and 25 member assertions passed, including blocker persistence after activity truncation and process exit.
- `node scripts/verify-team-review-ui.mjs`: isolated Electron checks for compact layout, HTML script isolation, PDF rendering, explicit confirmation, approve/deny payloads, blockers, and narrow layout. Screenshots in `_verify/team-review-ui/`.
- Immutable-preview tests cover before/after content despite working-tree edits, binary PDF transport, missing files, stale requests, changed-file scoping, and mismatched prepared-review evidence.

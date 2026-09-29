# Implementation specification 11-4 — Launch, inspection, and app integration

Paired [task](../Tasks/Task-11-4.md). Normative [feature contract](../chorus-team-sessions-spec.md). **Implementation and verification in progress; see [application evidence](../Application-Verification.md).**

## Ownership and composition

Add `src/main/services/teamIpc.ts` for handler definitions/validation and `teamInstructionsCore.ts` for lead/helper instruction composition; add tests. `src/main/ipc.ts` remains the registration owner: call the new registration helper from `registerIpc`, rather than register channels in a renderer or service constructor.

Construct TeamStorage, TeamWorkspaceService, TeamService and TeamBridgeService in `src/main/index.ts` after storage/session/worktree dependencies exist. Wire shutdown ownership there. Reconcile worktrees, then teams, then ordinary sessions. Add the initial team-lead restore exclusion through SessionManager's Task 11-2-provided predicate seam; 11-5 hardens all entry points. No momentary auto-launch is allowed before a later pause.

Create `src/renderer/src/stores/team.ts`, its tests, `components/TeamLaunchDialog.vue` and `components/TeamPanel.vue`. Add a Team entry and nested dialog in LaunchDialog; mount the panel inside TerminalPane's existing session view. Preserve its pre-existing edits and independent pane preset behavior. No additional helper pane or global layout rewrite.

Extend shared/ipc.ts with channel names and imports/exports of 11-2's team schemas/types. Add preload forwarders and `src/preload/index.d.ts` declarations consistent with its existing API structure. Preload never executes Zod. Snapshot reactive state into plain data before invocation; validate both response and pushed events in main.

## IPC contract

Register these narrowly scoped channels; all handlers verify the requesting renderer is an allowed app window and resolve project/run ownership in main:

| Channel | Contract |
|---|---|
| `team:capabilities` | Project/config query → verified member options and disabled reasons. |
| `team:launch` | Client request ID, project, selected revision, validated config → run/lead session/workspace identity or typed blocker. |
| `team:list` | Project → persisted team summaries, including paused/history. |
| `team:snapshot` | Run/afterSequence → current state plus bounded events. |
| `team:control` | Run, expected version, action activate/recover/pause/resume/stop/complete → new state. Resume/launch create full roster leases; explicit Recover creates a lead-only lease. Activate rechecks an existing preparing run/lead and never spawns another. |
| `team:decide-integration` | Integration ID/version and approve/reject → state; actor set by main, never payload. |
| `team:preset-list` | Project → reusable configuration summaries. |
| `team:preset-save` | Optional ID, expected version, label, validated config → stored version. |
| `team:preset-delete` | ID/version → deletion; historical runs retained. |
| `team:changed` | Main push of run ID/version/last sequence; renderer fetches a bounded snapshot. |

No arbitrary terminal write, helper shell, file path launch, SQL or credential-value API is added. IDs are resolved through storage. Concurrent launch clicks use one request identity and return one run. Save conflicts and stale approvals return explicit conflict responses.

The renderer store maintains versioned snapshots keyed by run ID, discards older pushes and unsubscribes on disposal. Reattach by lead session ID after renderer remount. Cap event pages at 200 records and request later pages by sequence. Do not infer completed work from disappearing activity or a missing snapshot.

## Launch pipeline

1. Resolve config and capability evidence, Git base commit and selected credential/provider relationships. Reject ineligible combinations before creating workspaces or decrypting anything.
2. Persist preparing run/member snapshots, create the integration workspace, create the lead session record, and create the run's launch authorization lease. Journal partial launch so a failed later step remains recoverable.
3. Start the broker and derive the scoped bridge configuration. Resolve absolute Node executable and bridge script path in main; no reliance on cwd for either.
4. Compose team instructions and MCP server with the existing memory server list once. Use 11-1's `teamLead.ts` descriptor for team-scoped external-file/launch-override delivery; do not invoke the ordinary project-writing `wireMcpForLaunch` branch for a team lead. Preserve user-owned config; refuse duplicate `chorus-team` server definitions rather than overwrite one. Require isolated Chorus-owned configuration outside all team worktrees; there is no project-file-writing fallback for team eligibility. Pass existing memory server definitions into this same external configuration so they are preserved. Never alter global tool configuration.
5. Pass secrets only in the lead environment; use existing adapter-specific variable-name/placeholder mechanisms in config. Include team-specific values in the scrubber. Helpers inherit none of this broker authorization.
6. Launch the lead through SessionManager, attach the ordinary pane view, and promote the run active only once the required bridge handshake is observed. Handshake timeout is 60 seconds; a folder/MCP trust prompt is displayed in the lead terminal and the run remains preparing. The user can finish trust setup and explicitly retry activation using `team:control` action activate without duplicating the run. Stop handles partial launch.

For accepted preset/config launch snapshots, edits after launch affect future runs only. On explicit resume, revalidate current referenced credentials and supported routes; changed meaning requires a new reviewed configuration rather than silent fallback.

## Instruction contract

`teamInstructionsCore` appends the team policy to existing adapter instructions without replacing memory instructions. Include roster IDs, operation semantics, dependency rules, process limits, review phases and how to wait for outstanding work. The lead should delegate independent bounded work, inspect artifacts, review prepared diffs, and verify integrated results. It must keep final user communication in the lead terminal.

Specify the cooperative no-write interval during managed integration and the requirement to checkpoint/clean the integration worktree before requesting it. Helpers get their assigned brief, base revision, setup/testing requirements, result expectations and prohibition on untracked recursive delegation. Avoid copying whole conversations or provider credentials into instructions.

The lead sees helper permission failures in tool results and discusses them with the user. There is no hidden helper terminal awaiting input. Approved roster/policy changes are made through a new team configuration in this release, not an agent-edited prompt.

## UI details and lifecycle

Launch: show lead harness/model/auth; roster with add/remove up to 16; helper concurrency 1–8 (default 2); timeout 5–240 minutes (default 30); fixed three-attempt ceiling; integration policy default ask. Validate required fields and expose disabled reasons beside the affected selection. Route/model selectors reuse existing capability/catalog vocabulary.

Panel: show states and queued/runtime durations separately, model/provider attribution, test provenance, changed files, activity and bounded output. Exact approval surface shows artifact/result/base identities, prepared diff summary, review evidence, selected policy, and current record version. A stale response refreshes the bundle; it never automatically resubmits approval.

Pause displays Pausing until active work drains; Stop visibly cancels processes and preserves output. Complete is available only with no unfinished task/integration and revokes the authorization lease. Explicit Resume can reopen a completed/paused team for further work after revalidation. Before resume replacement, confirm the previous lead process tree exited, preserving the lead session record and verified conversation pointer. Unknown identity blocks replacement. Because broker credentials are generation-scoped, resume reestablishes the lead execution and bridge; preserve the conversation through a verified pointer or clearly label the replacement handoff. Closing the view detaches; it does not silently stop or delete the team.

Recover is available only for ordinary retained dirt with all writers accounted for and no ambiguous integration. It launches a lead-only recovery session with a prominent Recovery only label; no helper dispatch or integration. The user steers that lead to inspect/checkpoint work, then explicitly resumes after reconciliation. Unknown writers and ambiguous applying effects remain blocked with actionable evidence.

All instructions/corrections go through the lead. Team controls and approval buttons are lifecycle/policy actions, not a second helper conversation. Usage displays unknown/floor/partial labels with coverage; no zero-dollar subscription implication. Preserve keyboard focus and terminal input while expanding the panel; buttons have accessible names and state labels.

## Packaging and verification

Add `resources/teamBridge.cjs` to electron-builder.yml extraResources under `team/teamBridge.cjs`. Dev resolves the repository resources path; packaged resolves `process.resourcesPath/team/teamBridge.cjs`. The detected Node executable runs it; do not rely on Electron's run-as-node fuse. No build system change or new dependency is required for this plain CJS resource.

Unit tests cover handler validation, actor provenance, response parsing, snapshot versions, plain-object inputs, preset immutability, duplicate launches and instruction composition. Live dev and packaged tests cover both leads, cross-provider helpers, exact-content approval, resized panes, keyboard interaction, renderer reload, selected credential labels, memory+team MCP coexistence and lifecycle behavior.

Record actual screenshot/log/command evidence without secrets. Hand startup order, generic session/delete guards and partial-launch journals to 11-5. Only task-owned changes enter the task commit; update upstream contracts explicitly if implementation reveals a missing field.


## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is still pending.

Render CLI-managed subscription account scope and verified/unsupported capabilities honestly. Carry explicit team launch authority and preserve only proven per-launch MCP settings. Each Resume/replacement rotates generation and closes old bridge requests; Recover/Pausing are inspection-only. Display timeouts separately from structured permission blocks, approval-wait time separately from execution, and metering estimates separately from billed spend. Preserve exact test evidence/provenance and enforce actor/ownership guards.

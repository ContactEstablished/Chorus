# Phase 11 execution handoff

Continue from the implementation progress recorded in roadmap.md, Compatibility-Report.md, Runtime-Verification.md and Implementation-Progress.md. Tasks 11-1 and 11-2 passed their gates; Task 11-3 is in progress. Preserve all existing implementation work.

Implement Chorus Phase 11 — Team Sessions, following `docs/Features/Team Sessions/chorus-team-sessions-spec.md` and `Tasks/Phase-11-Overview.md`. Read CLAUDE.md, docs/Plan.md and the relevant Foundation roadmap entries before editing. Follow tasks 11-1 through 11-5 sequentially, each with its matching ImplementationSpec.

Required behavior: Claude Code or Codex interactive lead, user-selected cross-provider helpers through supported CLIs, mixed subscription/API auth, isolated worktrees, lead-only steering, inspectable helper activity, session-selected integration approval, new launch/presets, bounded attempts/concurrency/time and paused restart recovery. Do not reduce the required lead/provider scope to make a test pass.

First inspect branch/status and preserve all pre-existing changes. The planning snapshot had package/package-lock and TerminalPane changes plus untracked .claude/.procoder content; current state may differ. Reverify current source symbols, CLI flags and migration registry. Do not use planning observations as runtime proof.

The council ran on 2026-09-20. Read Council-Disposition.md and feature §10 for the adopted amendments and partial-review limitations. The 11-1 compatibility gate has passed for the exact combinations in its report; reverify any changed combination. The gate must prove both lead paths and required helper routes before runtime adoption. No dependency addition or global CLI configuration mutation is preapproved by the plan.

Respect per-task ownership and Task 11-5's explicit final integration exception. Keep production process ownership in SessionManager/main, use typed validated IPC, preserve secrets, and do not claim CLI worktrees provide OS sandboxing. Review approvals bind exact artifact/base/prepared-result identities. Git effects must be journaled and recovered from evidence.

Record real verification per task. Run complete static/build/secret checks plus the Electron storage/recovery verifiers and real dev/packaged app drives. Finish with all 18 evaluation runs and an honest report of quality, elapsed time and available usage/cost. Do not silently omit failed runs or unknown metering.

Update phase status only when the required evidence is present. If blocked, state the exact gate, evidence and preserved work. Do not invent council findings, claim a mocked test proves runtime behavior, or stage unrelated user changes.

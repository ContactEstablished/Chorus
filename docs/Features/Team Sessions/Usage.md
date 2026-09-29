# Using Team Sessions

Team Sessions is implemented in the working tree. The restored 0.7.12 installer includes the recovery-checkpoint instruction correction. Packaged verification runs with Advanced Threat Defense disabled; compatibility with it enabled is not established. See [current implementation and release status](Release-Restoration.md) and a [completed development-session screenshot](Evidence/Window-3/claude-workflow.png).

Open a project's launch dialog and choose **Team session**. Select one lead and at least one helper. The lead owns the terminal you interact with; helpers execute delegated tasks in isolated worktrees. Multiple roster entries can use the same available model. **Concurrent helpers** controls how many may execute at once, independently of roster size.

The current verified options are Claude Code/Sonnet and Codex/gpt-6-astra using their signed-in CLI accounts, plus opencode/OpenRouter GLM-5.3 helpers using a selected saved API credential. Availability is checked against the exact installed CLI version and authentication route. **Unavailable options** explains a disabled choice. This initial implementation does not expose arbitrary model combinations or switch CLI subscription accounts.

Choose a committed base, helper timeout and integration policy:

- **Ask me before applying reviewed changes** presents the prepared result and review/test evidence in the Team panel. **Approve this result** authorizes that exact result; a changed result requires a new decision.
- **Lead may apply reviewed changes** allows the lead to apply its reviewed result to the dedicated Team branch. It does not merge into your destination branch or push changes.

Choose **Launch team**, finish any native CLI trust prompt, and describe the task in the lead terminal. For example: “Use the helpers to implement these two independent changes, review their results, and run the integrated tests.” Expand **Team** to inspect task status, attempts, helper activity, reviews and pending decisions. Corrections go to the lead terminal. Helpers are read-only views; they do not get separate interactive panes.

If the lead ends its turn while waiting for approval, approve in the panel and ask it to check Team status and continue. Native CLI command approvals remain separate from Team integration approval.

The initial Claude and opencode code-helper permission rules allow file edits and the exact shell command `node --test`. Filename arguments, compound shell commands and other test runners may return a permission blocker. Give those helpers briefs that fit this limit; the lead can perform additional verification in its interactive terminal. Codex helpers use their verified workspace-write sandbox. A helper permission denial is retained as an attempt and requires an explicit revision; it does not open a hidden approval prompt.

**Pause** revokes new dispatch and drains owned work before reaching paused state. **Resume** explicitly authorizes continuation. After an application restart, retained Teams stay paused; they do not launch agents automatically. If retained dirty work blocks Resume, **Recover retained work** provides a lead for resolving it with helper dispatch and integration disabled.

Closing the pane detaches the view. Reopen it through **Existing teams → Open lead**. **Stop** ends the Team while retaining worktrees and history. Once the task and integration checks are complete, **Complete team** records completion. Destination-branch integration remains a separate user-directed operation.

Use **Reusable team presets** to save a roster and launch settings. Reported token usage may be incomplete, and subscription expenditure is unknown. The [recorded comparison](Evaluation-Report.md) does not establish time or cost savings.

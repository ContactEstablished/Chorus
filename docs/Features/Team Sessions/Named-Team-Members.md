# Named Team Members — v0.7.13

Implemented 2026-09-21 following the user's request to create a reusable helper roster with friendly names, model IDs, and API keys.

## Using it

Open **Launch an Agent → Team session → Manage team members**. Choose **Create member**, enter a friendly name and the exact OpenRouter `vendor/model` ID, then enter an API key or choose an existing saved OpenRouter credential. Optional role instructions describe the member's specialty. Save and choose **Use in team**; repeat to assemble the helper roster. Claude or Codex remains the interactive lead.

The initial provider/harness combination is OpenRouter through OpenCode. These fields are displayed explicitly. This release does not add arbitrary API endpoints or direct-provider adapters. Member profiles are reusable across projects. Team presets save an assembled roster separately.

Keys are encrypted with the existing Windows credential vault. Editing a member does not reveal its key; choose another saved credential or enter a different key. The same key on the same provider reuses the existing credential. Removing a member preserves its credential and past Team runs. Credentials referenced by a saved member cannot be deleted through Settings until the reference is removed.

## Architecture and scope change

This addendum supersedes the fixed helper-model allowlist **only for explicitly selected custom OpenRouter models**. The measured OpenCode adapter/version, structured output, route, authorization, process ownership, workspace, permissions, and integration gates remain in force. Unknown models are labeled custom; being selectable is not a claim that a model has passed Chorus's behavioral evaluation. Invalid IDs and provider failures remain explicit errors. Saving a profile does not make an API request to validate the key or model.

- `team_member_profiles` is migration 27, with versioned JSON definitions and a restricted foreign key to the encrypted credential table. It contains no API key.
- `TeamMemberProfiles` atomically saves a profile and any newly encrypted credential. Version conflicts are checked before credential creation, and storage failure rolls back both writes.
- Three typed, strict-Zod main-window IPC operations list, save, and delete member profiles. The API key is write-only; responses contain safe metadata. Renderer form input remains component-local and is cleared after save, cancellation, or leaving the editor.
- Each launched run snapshots the selected member's friendly name, model, credential reference, instructions, and custom-model flag. Editing or deleting the reusable profile does not mutate an existing run. Historical records without the new optional fields retain their payload representation.
- Custom OpenRouter model IDs are declared in `OPENCODE_CONFIG_CONTENT` for that helper launch, including models absent from OpenCode's preloaded catalog. There are no global OpenCode config edits. The selected API key enters only the helper environment, and role instructions enter stdin under the existing helper contract.
- Removing a selected member leaves an explicit unavailable selection. Presets match named identity and instructions as well as model/credential/version, so a changed definition cannot silently substitute a different member.

OpenCode's official [provider documentation](https://opencode.ai/docs/providers/#openrouter) specifies declaring additional OpenRouter model IDs in `provider.openrouter.models`; its [CLI documentation](https://opencode.ai/docs/cli/) specifies provider/model selection. The installed `opencode run --help` was checked during implementation.

## Verification

- Typecheck and production/NSIS build passed; version is 0.7.13.
- 109 unit-test files / 3,431 tests passed, including schema/model routing, custom-versus-verified eligibility, stdin instructions, and write-only IPC error behavior.
- Real Electron/SQLite/DPAPI verification passed: 46 storage, 95 runtime, 46 workspace, 70 integration, and 25 member assertions. Includes upgrade from v26, encryption round-trip, no plaintext key in the database or list response, credential reuse, stale-update refusal before key insertion, post-insert failure rollback, deletion restrictions, immutable run settings, persistence, and custom-model dispatch through launch/activation/execution gates. Runtime dispatch uses a controlled executor; it is distinct from the live provider workflow.
- Packaged Vue/preload/main tests passed for create/edit/delete, saved-key reuse, password input and no returned key, custom helper selection, explicit deleted selection, stale-write refusal, and renderer reload. Existing preset/history/ordinary credential-restore checks also passed. App exit was clean. Screenshots were inspected.
- A live packaged workflow created a named `qwen/qwen3-coder` member through the new IPC using the selected disposable encrypted OpenRouter credential. A Claude lead delegated the code fix, the selected helper completed, the lead reviewed and integrated it, and independent `node --test` verification passed against the committed result with the original test unchanged. Pause/resume, generation rotation, stop confirmation, and clean app exit also passed. This was one bounded fixture under `lead-integrates`, not a general model-quality benchmark. The model ID and tool support were checked against OpenRouter's public model catalog before the run.
- Secret scan passed. `git diff --check` retains a pre-existing TerminalPane font-line whitespace finding, unrelated to this feature.

Evidence: `_verify/team-members-unit.log`, `_verify/team-members-native.log`, `_verify/team-members-build.log`, `_verify/team-members-secrets.log`, and `_verify/team-members-ui.log`. Detailed native report: `C:\Users\matth\AppData\Local\Temp\chorus-team-storage-fE3j3p\report.json`. Packaged UI report/screenshots: `C:\Users\matth\AppData\Local\Temp\chorus-team-app-XCJOLW`.

Live workflow: `_verify/team-members-live.log`; detailed report, independent acceptance, snapshots, and clean exit: `C:\Users\matth\AppData\Local\Temp\chorus-team-packaged-AtWjv8`. The user's installed profile was not used as the running test profile.

Installer: `release/Chorus Setup 0.7.13.exe`.

- Installer SHA-256: `75541d039a072851f4dffa7533b38cd96569264870e8a849a8a35d6c7ca585e3`
- Tested packaged `app.asar` SHA-256: `47c34ca2973968476c509f97e70448ab955285715ef1dfe57c7c3dbbce0f0c98`

The installer was built for the user to run; their installed application/profile was not upgraded by this task. This feature's evidence does not expand earlier release claims about antivirus-enabled installation, Codex recovery, or arbitrary model reliability.

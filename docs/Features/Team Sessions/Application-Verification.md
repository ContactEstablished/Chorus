# Phase 11 application verification — 2026-09-20

**Latest packaged continuation:** The user disabled Advanced Threat Defense and authorized recreation. The 0.7.12 package and installer were restored, a recovery-instruction conflict was corrected, and packaged checks resumed. Protection-enabled compatibility remains unverified. See the [restoration record](Release-Restoration.md) for current results and the superseding installer hash.

This records actual evidence from disposable repositories/profiles. It is not a release-completion or performance claim. The full Task 11-4/11-5 matrix remains open.

## Release-window results — 2026-09-21, 10:20 UTC onward

These checks use the real built development application with isolated profiles and repositories. Production source continuity was checked against the prior window; all 56 recorded production files match. They do not certify the packaged executable interrupted by Bitdefender.

| Check | Result and retained evidence |
|---|---|
| Claude lead / Codex helper / lead-integrates | Passed full workflow, independent acceptance on a clean committed HEAD, unchanged test Git blob, keyboard input in both panel states, detach, Pause/Resume and Stop. [Report](Evidence/Window-4/claude-codex-workflow.json), 11:36 UTC. No out-of-band workflow guidance was supplied on this passing run. |
| Codex lead / Claude helper / ask | Passed visible approval, stale refusal, approval-preserving reload, independent acceptance, both keyboard states and lifecycle/Stop. [Report](Evidence/Window-4/codex-ask-workflow.json), 11:41 UTC. Two unsupported-command permission failures remain in history; the third counted attempt succeeded after one [controller clarification](Evidence/Window-4/codex-ask-guidance.json). |
| Actual-window mixed subscription/API roster | Claude lead with Claude subscription and opencode/OpenRouter GLM-5.3 API helpers. Observed two native running helpers concurrently; both modules passed independent tests with unchanged committed test blobs. Both tasks completed under ask policy, including visible approval/reload/stale refusal and confirmed Stop. [Report](Evidence/Window-4/mixed-app-workflow.json) and [screenshot](Evidence/Window-4/mixed-app-workflow.png), 11:41 UTC. Five attempts total, including three permission failures; one [controller clarification](Evidence/Window-4/mixed-app-guidance.json) corrected the fixture's unsupported per-file test command. |
| Main-app memory registration | Both native leads activated Team and created the expected graph session through the real main-app callback in an isolated Neo4j container. [Report](Evidence/Window-4/memory-app.json). Graph indexing was not exercised. |
| Closure after passing and failed verifier runs | Read-only closed-database audit confirms all five development fixtures persisted stopped runs, exited leads, lead-stopped events and confirmed attempt cessation; all apps exited 0. [Audit](Evidence/Window-4/app-closure.json). The earlier failed verifiers are not reclassified as passing workflows. |
| Packaged workflows | Fresh quarantine interrupted rebuilt Claude ask and Codex lead-integrates runs at 10:25–10:26 UTC. No full completion report exists for either. The 0.7.12 NSIS candidate was built and inspected, but the packaged matrix remains incomplete. [Window record](Release-Window-4.md). |

Verifier corrections are [retained separately](Evidence/Window-4/verifier-corrections.json): CRLF checkout normalization, an initializer error before process launch, and unsupported test-command arguments. The passing retries do not erase these failures. Claude/opencode helper rules permit the exact command `node --test`; no permission policy was widened to obtain a passing result. Full traces remain at the temporary paths recorded in each report.

## Prior-window results — 2026-09-21, before 02:16 UTC

This table supersedes the earlier chronological pending-work notes below. Window-driven checks used the built development application, not the quarantined portable package. Mixed-roster and Neo4j rows use production-service composition fixtures, as identified below.

| Check | Result and evidence |
|---|---|
| Codex lead, lead-integrates workflow | Passed helper delegation, immutable/prepared review, accepted integrated tests, visible helper activity, seven ownership guards, detach, Pause/Resume/generation rotation and confirmed Stop. `%TEMP%/chorus-team-development-3In5Bf/report.json`, 01:39:04 UTC. |
| Claude lead, ask workflow on latest code | Passed visible approval, stale-decision refusal, reload while awaiting approval, integrated acceptance and lifecycle/Stop. `%TEMP%/chorus-team-development-wSIKqZ/report.json`, 01:57:30 UTC. No out-of-band terminal guidance was supplied; the fixture automated scoped trust, bounded native command approvals and the Team-panel decision. |
| Mixed subscription/API production roster | Passed both modules and all nine independent tests with Claude subscription and opencode/OpenRouter GLM-5.3 API helpers, three attempts/one revision and confirmed shutdown. `%TEMP%/chorus-team-evaluation-t52Ezt/parallel-feature-pair1-team/report.json`. This separate pilot is excluded from the 18 comparisons. Earlier failed-cleanup pilots remain retained. |
| Dirty-work recovery and ordinary presets | Passed dirty Resume refusal, visible Recovery-only lead, exact retained-file checkpoint, no helper dispatch, explicit Resume and confirmed Stop. Actual Solo, Pair, Workbench and Swarm launch drives passed session count, live status and workspace-sharing/isolation checks. `%TEMP%/chorus-team-development-zoQBAD/report.json`, 01:42:31 UTC. One extra controller approval covered inspected read-only file/hash checks. A later attempted approval was not delivered because the app had already completed; the intervention log says so. |
| Quit during a native running helper | Passed actual window close, application exit 0, durable stopped run, terminal attempts and confirmed cessation. `%TEMP%/chorus-team-development-ONfcrE/report.json`, 01:45:49 UTC. |
| Quit during integration preparation | Passed with the before-quit state explicitly `preparing`, retained integration records and settled shutdown. `%TEMP%/chorus-team-development-myyaAn/report.json`, 01:49:03 UTC. |
| Quit during integration apply | Passed with the before-quit state explicitly `applying`; promotion settled as applied, source checkout remained unchanged, records survived and shutdown was confirmed. `%TEMP%/chorus-team-development-10YOHQ/report.json`, 01:54:00 UTC. |
| Attempt limit and retained history | Passed actual window reopening after renderer reload, visible 3/3 attempt count and exhaustion guidance, with no new process. Deterministic core-transition fixture; not three model failures. `%TEMP%/chorus-team-app-nD4hLj/report.json`, 01:59:02 UTC. |
| Ordinary credentialed restore refusal | The same actual-app fixture retained a previously running ordinary pane with a missing saved launch-profile reference. Boot healed it to exited without a keyless PTY; public attach returned exited/empty output and the native restore log confirmed the credentialed refusal. No real key was copied or decrypted. |
| Activation timeout and retry | Held native trust pending until the real 60-second bridge timeout, clicked Retry activation in the visible panel, confirmed no replacement/generation change, then trusted the fixture and completed activation/lifecycle. `%TEMP%/chorus-team-development-HzArUs/report.json`, 01:59:10 UTC. An earlier reused/trusted source skipped the branch and is explicitly not counted; the verifier now fails that skip. |
| Actual Neo4j MCP alongside Team tools | Both leads called Team roster and the installed cached Neo4j MCP server's constant `RETURN` probe, with confirmed shutdown. Claude: `%TEMP%/chorus-team-production-mVQslE/report.json`; Codex: `%TEMP%/chorus-team-production-tfHVyd/report.json`. Claude required one native read-tool approval. No graph records were read or written. |

Final screenshots from `chorus-team-app-nD4hLj/exhausted-history.png` and `chorus-team-development-wSIKqZ/workflow-complete.png` were visually inspected. The seeded history fixture intentionally lacks an integration workspace and displays the conservative missing-ownership warning; its pass covers reopening, exhaustion presentation and no spawn, not healthy-workspace recovery. The completed Claude screen shows a reviewed completed task, successful helper attempt, inspectable activity and the single lead terminal.

The Neo4j check uses the production Team composition with an observing stdio wrapper around the installed MCP package. It does not exercise the main application's memory-registration callback or graph indexing. Earlier attempts `S2DL61` and `AnKWdy` timed out; diagnostics identified `spawn uvx ENOENT` inside the observer, corrected by passing the installed absolute executable path. No global CLI configuration, security settings, dependency installation or quarantine restoration was performed.

**Release remains open:** the final packaged both-lead/policy matrix cannot be certified while Bitdefender quarantines the portable test build. The 18-comparison report is amended exploratory evidence across two bundles, not a controlled single-build performance certification. See [Release-Gate-Audit.md](Release-Gate-Audit.md).

## Production composition

`scripts/verify-team-production.mjs <claude|codex>` bundles the production TeamRuntime, SessionManager, GitWorktreeManager, StorageService and vault into a native Electron fixture. It probes installed CLI versions, creates a separate repository/profile, launches the real interactive lead through ConPTY, waits for the authenticated native-Node bridge, and submits a bounded bug-fix task. A fixture user approves the exact prepared result through the same TeamService decision path. The lead must independently test the integrated result before the task can complete. Source HEAD and working tree preservation are asserted.

| Lead | Result | Evidence |
|---|---|---|
| Codex 0.155.1 / gpt-6-astra / subscription | Passed: Claude helper, immutable artifact review, preparation, ask-policy decision, ff-only apply, independent integrated node:test and completed task | `%TEMP%/chorus-team-production-V2x2Mx/report.json`, 22:13:52 UTC |
| Claude Code 2.1.278 / sonnet / subscription | Passed the same complete workflow | `%TEMP%/chorus-team-production-sw0jau/report.json`, 22:51:02 UTC |

These earlier fixtures used one subscription helper. Alone they do not establish mixed-provider roster coverage or comparative quality/time/cost. The later current-results table records mixed-provider and renderer-level lead-integrates passes separately.

## Actual window and package

`verify-team-app.mjs` drives the built real main/preload/renderer with an isolated profile. `%TEMP%/chorus-team-app-L0Na3h/report.json` passed Team launch-dialog visibility, a 900×650 resize, plain-object preset IPC/CAS and renderer reload. Captured images were inspected.

The unpacked executable was built with `node node_modules/electron-builder/cli.js --win --dir --config _verify/team-package.json`. Its resource path is `resources/team/teamBridge.cjs`; the facade runs with native Node rather than Electron. `verify-team-packaged.mjs <isolated-app-evidence> <lead>` launches that executable with a copied fixture profile and local-only DevTools transport. It never opens the installed user's profile.

| Lead | Latest packaged result | Evidence |
|---|---|---|
| Codex | Bridge handshake; attached Team panel; seven ordinary lifecycle/cleanup refusals; view detach preserves active run; Pause then Resume rotates generation and preserves session ID; Stop reaches stopped after process cessation | `%TEMP%/chorus-team-packaged-5LGqog/report.json`, 22:56:54 UTC |
| Claude | Same checks passed | `%TEMP%/chorus-team-packaged-I3DMWq/report.json`, 22:57:08 UTC |

The seven refusal checks are ordinary session Restart, Relaunch, Kill and Delete, worktree removal, project deletion and project archive. Hide remains available. These prove main-process guards through the actual preload/renderer, beyond unit assertions. Earlier package checks only acknowledged Stop; the later reports explicitly wait for stopped state.

## MCP composition

The production fixture has a separate `mcp` mode with a disposable read-only memory MCP peer. It injects an ephemeral nonce through the child environment, uses placeholders/names in generated configuration, and asserts the nonce never appears in command arguments or retained terminal output.

Claude passed the probe while its Team bridge was active: `%TEMP%/chorus-team-production-pf9AXN/report.json`, 23:08:06 UTC. This proves composition with a separate MCP peer, not Neo4j data correctness. The Codex probe in `%TEMP%/chorus-team-production-BnIckA` stalled at a native pre-tool hook after Team roster succeeded; its owned descendants included PowerShell/GitKraken. It is not counted as a pass. No global hooks or user CLI settings were disabled to conceal the stall.

## Retained failures and corrections

- Early production launch incorrectly required a sessionless managed worktree to be active rather than detached; the production composition now accepts the reserved detached state.
- Live CLI evidence revealed ordinary `extraArgs` is argument-level precedence, not an argv append. A main-only Team argument seam now delivers MCP/model/native-agent restrictions, with SessionManager regression tests.
- Early trust automation sent input before the CLI had settled. Later fixture trust acceptance was scoped to each disposable directory and waited for the rendered prompt.
- Claude initially prompted for every Team tool; only the eight run-authenticated facade tools receive native per-tool allowance. Shell commands retain native permission prompts.
- Claude's earlier full-flow runs timed out at permission prompts or final review SHA confusion. `originalResultSha` is the prepared/promoted result, not the helper artifact. Shared schema descriptions and lead instructions now state this explicitly. Failures remain in `qCYu2T`, `HIUTvp`, `pwndYG` and earlier `chorus-team-production-*` directories. The later successful run does not erase those failures.
- Packaged fixture mistakes included path spelling, a raw carriage return in an evaluated JavaScript string and reused lead/helper member identity. They were corrected in the verifier; failed evidence remains in the earlier package directories.
- The full suite initially found two stale global IPC-count assertions (117 versus 127). Counts and explanations now include nine Team invokes plus one push; the subsequent full suite passed.
- Three later full packaged workflow attempts (`WUaQpE`, Codex/lead-integrates; `34y1dF` and `ci8Glv`, Claude/ask) ended before integrated verification. **Bitdefender quarantine is confirmed:** read-only quarantine metadata names both `_verify/team-packaged-latest/win-unpacked/Chorus.exe` and `_verify/team-packaged-window-final/win-unpacked/Chorus.exe`, their external `teamBridge.cjs`, and all three disposable profiles' SQLite WAL files. Records are timestamped 23:21:20–35 and 23:33:38–39 UTC. Extracted path/time/metadata-file evidence is `_verify/phase11-antivirus-evidence.json`. Earlier app/terminal/snapshot files remain, but the affected profiles are incomplete and must not be treated as recoverable evidence. These runs do not pass. No exclusions, restoration, security-setting changes or detection-evasion changes were attempted. The underlying detection reason has not been established.
- The verifier now records native exit status and rejects closed or timed-out DevTools requests instead of leaving an unresolved operation. That cannot capture the abrupt termination of the verifier itself. A separate launcher diagnostic then refused startup because the quarantined bridge was missing. The Codex workflow attempt also recorded a helper permission refusal for combining the allowlisted test command with another shell command.

The quarantined executable's metadata labels the detection `Atc4.Detection`. That identifies the recorded label, not the precise triggering behavior or proof of a false positive. The extracted evidence includes SHA-256 hashes of the current source bridge, process-ownership implementation and production composition for follow-up review. Installed user Chorus processes were not stopped or altered.

## Earlier remaining-work checkpoint

At this checkpoint, mixed subscription/API helpers, both policy workflows, dirty-work Recover, quit races, stale approval/exhaustion UI, ordinary presets and Neo4j coexistence still lacked final evidence. The current-results table now records those development/native checks and their limits. Bitdefender packaging investigation and final packaged verification remain open; no Team installer or version release has been made.

## Continuation evidence — 2026-09-21

After the user reported whitelisting Chorus, the rebuilt test package was quarantined again at 23:51–23:52 UTC. Read-only evidence is `_verify/phase11-window3-antivirus.json`; attempts `chorus-team-packaged-sjOVJm` and `chorus-team-packaged-J4kK58` did not pass. This was reported to the user and package reruns stopped. No antivirus settings or quarantine contents were changed.

`verify-team-packaged.mjs` now accepts `--dev`, driving the real built main/preload/renderer through Electron. Reports distinguish development from packaged execution. The Claude ask-policy workflow passed at `%TEMP%/chorus-team-development-HP0xx8/report.json`, 00:41:43 UTC: helper activity, immutable/prepared review, visible exact-result approval, stale-approval refusal, renderer reload while approval remained pending, final integrated tests, source preservation, seven ownership guards, view detach, Pause/Resume with generation rotation, and confirmed Stop. See `workflow-complete.png` and retained snapshots. This run used explicit controller instructions to continue after the lead ended its approval-wait turn and to clarify the ambiguous apply `reviewedHead` field; these are retained in `controller-interventions.json`. One additional native test-command approval was supplied through the terminal. It is functional evidence with intervention, not an unattended pass.

The mixed production roster in `%TEMP%/chorus-team-evaluation-3LxDpU/parallel-feature-pair1-team/report.json` completed two modules with Claude subscription and opencode/OpenRouter GLM-5.3 API helpers, immutable integrations and all nine independent acceptance tests passing. Only the selected encrypted profile/provider were copied from the existing diagnostic profile; its source database was opened read-only, and the production vault resolved the API credential at helper launch. Four attempts, including two explicit revisions after permission blocks, were retained. This pilot required a controller approval after obsolete terminal text confused the initial approval filter. Its code passed, but **shutdown was unconfirmed**, so the matrix row is not fully certified. It ran the earlier bundle before the stop-batch correction.

The pilot exposed that stopping a root could make a child disappear during `Stop-Process`, aborting the remaining batch. Each identity is now checked and signaled independently; an error cannot skip later owned children. Final identity inspection still decides cessation. Lead stop retains bounded native rechecks and durable failure-stage evidence. The later complete app pass includes the correction. Earlier passing-code/failed-cleanup pilots `chorus-team-evaluation-kfcYJo` and `chorus-team-evaluation-UhqOnT` remain failures of that lifecycle gate.

Live helper follow-up, credential-mutation resume checks and expanded crash cases are recorded in [Recovery-Verification.md](Recovery-Verification.md). The lead contract now directs approval waits through bounded `team_wait`; the panel explains an approved result if the lead nevertheless ends its turn. Tool schema descriptions distinguish the artifact SHA required by both integrate actions from the prepared/result review SHAs.

Open application rows still include mixed-roster confirmed shutdown, a complete Codex development-window workflow, dirty-work Recover interaction, active integration/quit, attempt-exhaustion UI, ordinary preset drives, actual Neo4j coexistence and the final packaged matrix. The formal comparison is a separate frozen 18-run batch; pilots above do not count toward it.

### Additional continuation preparations

The application driver gained `--recovery`, `--ordinary` and `--quit-active` modes for the dirty-work checkpoint path, existing launch presets, and closing the real window during a live helper. Those modes subsequently passed as recorded in the current-results table; the driver also gained preparation/apply quit modes. [Release-Gate-Audit.md](Release-Gate-Audit.md) tracks remaining limits.

A direct installed Neo4j MCP preflight passed at `%TEMP%/chorus-neo4j-preflight-3OfLQQ/probe.json`: the cached package connected to the existing local service at loopback port 7691 and returned a fresh constant. It read and wrote no graph records. `team-neo4j-probe.cjs` transparently observes that exact read-only request/response while forwarding the installed server's stdio; `uvx --offline` prevents dependency download. Both-lead coexistence subsequently passed as recorded above. Neither this preflight nor the later composition probes prove the main application's memory-registration/indexing callback.

The evaluation exposed lead requests for helper Git commits, which sandboxed helpers cannot always perform. Subsequent production instructions now explicitly assign immutable capture to Chorus, and each helper receives its code/analysis contract before the bounded brief. The evaluation bundles were retained unchanged for that guidance, so it is excluded from comparison results. Both affected instruction/adapter test files pass (15 tests); the production build and typechecks pass.

### Retained history and attempt-limit window

`node scripts/verify-team-app.mjs --history` passed at `%TEMP%/chorus-team-app-oiPLuM/report.json`, 01:35:13 UTC. This creates a disposable stopped run with three deterministic preparation-failure transitions, proves a fourth revision is refused, then opens its retained history through the actual application after renderer reload. The pane shows `Attempts: 3 / 3`, explains exhaustion, and retains the exited lead without launching a process. `exhausted-history.png` was visually inspected at 900×650. This is a seeded UI/core test, not three live model failures.

The drive found a real reopen defect: `App.onLaunched` returned early when a session row already existed, even if its pane had been detached. It now restores the missing layout leaf before focusing; the existing layout operation preserves a leaf already present. Layout/Team-store tests pass (13 tests). Earlier failed UI attempts and an initial fixture foreign-key insertion-order error remain in their disposable evidence directories.

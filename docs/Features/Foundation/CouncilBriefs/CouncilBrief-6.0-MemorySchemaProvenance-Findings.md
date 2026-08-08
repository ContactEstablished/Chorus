> Council of 4 members plus an arbiter. All members completed.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

# Council Findings — Memory Schema and Provenance for an Agent-Written Knowledge Graph

## Decision summary

| Question | Council ruling | Decision |
|---|---|---|
| Q1 | APPROVED WITH REVISIONS | Adopt all six corrections, plus schema and operational corrections. |
| Q2 | APPROVED WITH REVISIONS | Start with advisory-and-measured provenance, but make it operationally consequential and honest about its limits. |
| Q3 | REVISE | Do not ship credentialed memory’s environment flip under the current seven-variable allow-list and disclosure-only model. |
| Q4 | APPROVED WITH REVISIONS | Retain “names not values,” but narrow the security claim to persistent configuration and lifecycle protection. |
| Q5 | APPROVED WITH REVISIONS | Keep one container per project as the isolation unit, but manage lifecycle and recovery. |
| Q6 | APPROVED | Write configuration and disclose approval; do not pre-approve another CLI’s trust state. |

The council’s conclusions rely principally on the measured facts. Where conclusions depend on unverified CLI behavior—particularly environment-variable indirection support or approval gates in other CLIs—the product must not infer support or weaken the stated security posture.

---

# Per-member positions

## Deepseek-v4-flash-0731

| Question | Position |
|---|---|
| Q1 | AGREE |
| Q2 | AGREE |
| Q3 | QUALIFY |
| Q4 | QUALIFY |
| Q5 | QUALIFY |
| Q6 | AGREE |

Deepseek supports all six specification corrections and adds that repository identity and path identity need explicit worktree-aware modeling. It supports advisory provenance because unrestricted Cypher makes full enforcement unavailable without owning the MCP write surface. It requires visible provenance health, repair actions, and a distinction between constrained convenience paths and real enforcement.

For credentialed mode, it supports narrowing the environment only with explicit disclosure and a corrected allow-list. It treats the measured silent `npx` downgrade as a correctness failure. It supports “names not values” as protection against persistent configuration leakage, but not as protection against runtime process inspection or agent disclosure. It favors one container per project with on-demand lifecycle management and rejects shared label namespacing under arbitrary Cypher. It supports config writing plus approval disclosure, not pre-approval.

## GLM 5.2

| Question | Position |
|---|---|
| Q1 | AGREE |
| Q2 | AGREE |
| Q3 | QUALIFY |
| Q4 | QUALIFY |
| Q5 | QUALIFY |
| Q6 | AGREE |

GLM supports the six corrections and highlights the measured absence of APOC in the Community image: the specification must not depend on APOC procedures. It supports advisory provenance, provided unsourced memories become visible and can be excluded from app-supplied context where the user can understand that consequence.

GLM supports the security invariant behind the environment flip, but not disclosure alone. It recommends measured, minimal additions to the allow-list before credentialed mode is offered. It accepts the limited value of “names not values” for durable artifacts and credential rotation, while rejecting any broader runtime-confidentiality claim. It supports lifecycle-managed per-project containers and an approval-aware activation flow.

## Grok 4.5

| Question | Position |
|---|---|
| Q1 | AGREE |
| Q2 | AGREE |
| Q3 | QUALIFY |
| Q4 | QUALIFY |
| Q5 | QUALIFY |
| Q6 | AGREE |

Grok supports all six corrections but does not claim to certify unseen portions of the original specification. It identifies APOC absence and obsolete database-per-project language as adjacent specification risks. It supports advisory provenance with ratios, trends, remediation, sourced-material preference in app-generated context, and clear distinction between advisory quality signals and enforcement.

Grok rejects disclose-only treatment of the environment flip. It requires measured allow-list repair, an explicit confirmation gate, command-resolution verification, and a local-mode-first product posture. It supports retaining “names not values” only as a durable-config and secret-lifecycle rule. It strongly supports project container isolation under arbitrary Cypher and requires backup/recovery. It supports a state model of configured, pending approval, connected, and failed.

## Qwen 3.8

| Question | Position |
|---|---|
| Q1 | AGREE |
| Q2 | QUALIFY |
| Q3 | QUALIFY |
| Q4 | QUALIFY |
| Q5 | QUALIFY |
| Q6 | AGREE |

Qwen supports the six corrections and calls for stable worktree-aware identity rather than machine-specific absolute paths as the primary key material. It qualifies advisory provenance: it is acceptable as an initial design only if poor provenance is visible, actionable, and affects app-managed retrieval or context in a transparent way.

Qwen supports the secret-bearing environment profile in principle, but requires explicit confirmation, persistent profile indication, and carefully controlled expansion of the allow-list. It supports “names not values” as a meaningful control for durable configuration, not a control against same-user runtime access. It supports project containers with start/stop, lifecycle management, and recovery capability. It rejects treating written configuration as equivalent to connected memory when approval remains pending.

---

# Synthesis and rulings

## Q1: QUALIFY

Adopt all six listed corrections.

The measured facts support the corrections directly:

1. Bare `File.path` and `Class.fqn` uniqueness is invalid in a worktree-capable product.
2. One database per project is not available in the measured Neo4j Community deployment; a per-project container is the available isolation boundary.
3. Agent-authored numeric confidence is uncalibrated self-report and should not be represented as evidence.
4. Provenance relationships are more useful than strings because they can be traversed, inspected, validated, and repaired.
5. A generated local password is unnecessary in measured local mode and conflicts with the hard rule against storing secret values in tool config files.
6. The visible container prefix is an operational identifier in Docker Desktop and should use the current product name.

The composite uniqueness revision needs a further revision before it is considered complete. `(repo, path)` and `(repo, fqn)` are only correct if `repo` and `path` have precise, stable meanings. A repository identity shared by multiple simultaneously represented worktrees, combined with a worktree-relative path, can still collide. The schema should use a stable repository or worktree-instance identity and normalized repository-relative paths. Machine-specific absolute paths should be fallback metadata, not primary identity.

Additional corrections are required:

- The measured Community image contains no APOC procedures. The specification must not require APOC for validation, cleanup, migrations, or graph operations.
- Neo4j constraints can protect selected keys, but arbitrary Cypher means they do not enforce all schema rules or provenance completeness.
- The feature needs an explicit graph lifecycle model: create, start, stop, inventory, archive, backup/export, restore, prune, and delete.
- Arbitrary Cypher creates a graph-integrity risk beyond provenance: agents can bulk-modify, erase, poison, or delete memories and provenance relationships.

## Q2: QUALIFY

Adopt advisory-and-measured provenance as the initial architecture, rather than routing all writes through Chorus.

The measured architecture matters: agents call a standard MCP server directly, and that server accepts arbitrary Cypher. Full provenance enforcement would require Chorus to own a constrained MCP write API or make unrestricted Cypher writes unavailable. That would sacrifice general graph expressiveness and create an ongoing maintenance commitment for Chorus.

However, advisory measurement is acceptable only if it affects user understanding and app-controlled behavior. A bare count is decorative. At minimum, the validator should provide:

- numerator and denominator, for example: “43 of 512 memories lack a source”;
- ratio and historical trend;
- separation of newly-created unsourced memories from historical backlog;
- list or graph view of unsourced memories;
- breakdown by agent and, where meaningful, session;
- remediation instructions or an action that asks an agent to inspect and repair identified memories.

The app should present a visible provenance-health state, such as healthy, needs review, or untrusted. Where Chorus composes context or retrieves memories for a user-facing feature, it may visibly prefer sourced material or visibly label unsourced material. This must not be described as enforcement and must not silently hide material without user visibility and reversibility.

Partial enforcement is coherent only at boundaries Chorus controls: Chorus-authored nodes, imports, and app-composed context can require provenance or be marked untrusted. A constrained API for canonical memory types can be a higher-quality path, but unrestricted Cypher elsewhere means it is not a full provenance guarantee.

## Q3: DISAGREE

Do not approve the proposed “disclose and accept” environment flip as currently framed.

The underlying security policy is correct. Credentialed memory introduces a secret. Passing that password through the channel defined as non-secret would violate the security invariant. Keeping the full ambient environment while injecting the Neo4j password would also defeat the purpose of narrowing a secret-bearing pane’s environment.

But disclosure does not make a known correctness failure safe. Under the measured seven-variable allow-list, `npx` silently resolves to an older npm version, exits with code zero, and gives no warning. This is not merely a user-experience issue; it is a toolchain identity change caused by the environment transition.

Credentialed memory should remain unavailable for a subscription-authenticated pane until all of the following are true:

- Chorus has measured the minimal environment required for each supported agent CLI and launch path, including cold-cache behavior.
- Chorus retains an allow-list approach, not a broad deny-list. A deny-list risks exposing unknown, renamed, or tool-specific credentials.
- Any additions to the allow-list are justified by measurement and kept narrow.
- Chorus verifies command resolution and relevant launch prerequisites after narrowing the environment, and fails loudly if expected executables or versions resolve differently.
- The user explicitly confirms the transition before it occurs.
- The UI states that the pane becomes secret-bearing, shows the restricted profile and removed variables, and identifies local mode as the no-secret alternative.
- The pane continues to show a persistent restricted-environment indicator after activation.
- The specific CLI has an established compliant method to reference the secret by environment-variable name. Where this is unverified, credentialed memory must not be enabled for that CLI.

Measured local mode works without Neo4j credentials and does not cause the environment-policy flip. It should be the product default.

## Q4: QUALIFY

Retain the “names not values” posture, but narrow the claim it makes.

The strongest objection is valid. A secret injected into a child process environment is available to that process and may be readable by same-user processes able to inspect it. The agent may reveal it through commands, transcripts, debugging output, or induced behavior. A compromised agent, malicious MCP server, local malware, crash artifact, or debug log can expose the secret. Encryption at rest and process isolation provide most of the runtime protection; “names not values” does not defeat a determined runtime attacker.

The posture nevertheless does meaningful work against durable-artifact risks:

- It prevents secret values from being written into CLI configuration files.
- It reduces exposure through backups, cloud sync, repositories, copied dotfiles, support bundles, and screenshots of configuration.
- It prevents stale secret copies remaining in config after vault rotation or revocation.
- It centralizes credential lifecycle in the encrypted store.
- It prevents recurrence of the stated incident class in which a CLI silently preferred a config-file credential.
- It reduces secret duplication across tool-specific configuration formats.

Therefore, this should remain a hard rule for configuration and durable artifacts: configuration may name an environment variable, but may never contain the variable’s secret value.

The product must not claim that this protects secrets from the agent process or from all local processes. The accurate statement is: the secret is encrypted at rest and materialized only into a launched child process when required. A secret-bearing pane is trusted code with runtime access to that secret.

One CLI’s name-only passthrough is measured. Support in other CLIs remains partly unverified. The product must not weaken the rule to accommodate unsupported or unverified CLI behavior.

## Q5: QUALIFY

Keep one Neo4j container per project as the isolation unit, but define this as one project-owned container and volume, not one permanently running database.

A shared Neo4j instance with project labels is not adequate while agents have arbitrary Cypher writes. Labels and project identifiers are naming conventions, not access control. An agent could read, modify, delete, relabel, or poison another project’s graph. The measured Community limitation leaves the container as the practical project boundary.

The meaningful count is concurrently running containers, not all configured projects. A conservative operating default is:

- approximately **three concurrently running containers on a 16 GB workstation**;
- approximately **five concurrently running containers on a 32 GB workstation**.

These are planning limits, not universal hard caps. Chorus should also react to available system memory and active workload. The measured 512 MB–1 GB heap range is only part of the total workstation load; Docker, agent CLIs, editor, browser, desktop app, and operating system also matter.

The design should include:

- start on project open or focus;
- idle shutdown for unfocused projects;
- visible running and stopped states;
- a project memory inventory with last-used time, storage usage, and archive/delete controls;
- memory-pressure warnings and stopping of inactive databases;
- prompts to archive or remove long-unused graphs;
- backup/export and restore capability.

More than roughly five active databases should trigger lifecycle management by default. More than roughly ten always-running databases is not reasonable for a typical single-developer workstation. A larger number of stopped project containers may be acceptable if visible and managed.

Do not introduce a shared-instance “resource-saving mode” while arbitrary cross-project Cypher access remains possible. It becomes defensible only if access is mediated or otherwise restricted enough to restore a meaningful project boundary.

## Q6: AGREE

Write the MCP configuration and disclose the approval step. Do not pre-approve on the user’s behalf.

The measured Claude Code behavior establishes that written configuration is necessary but not sufficient: an unapproved server is not connected. Writing another tool’s approval state would be a different category of action. It would bypass a human trust gate, alter third-party trust state, and couple Chorus to undocumented approval-state implementation details.

The correct product state model is:

**Configured → Pending approval → Connected → Failed**

The application must not call memory “enabled” or “connected” merely because it wrote a config file. While approval is pending, it should show:

- the relevant agent and MCP server;
- that the graph is not connected yet;
- concise instructions to approve it in the interactive CLI;
- a re-check control;
- success only after a connection or probe read is confirmed.

The milestone “agents read and write a per-project memory graph via MCP” is met for a given agent/project only after approval has occurred and the CLI can connect. The broader product milestone may proceed with this one-time activation step if the UI represents the dependency honestly.

Whether other CLIs impose comparable approval gates is [UNVERIFIED]. That uncertainty supports a capability-based implementation: detect and display actual connection state for each agent rather than assuming all CLIs behave like Claude Code.

---

# Risks and mitigations

| Risk | Evidence status | Mitigation |
|---|---|---|
| Composite identity collisions across worktrees | Measured worktree use; exact identity model unresolved | Define stable repository/worktree-instance identity and normalized repository-relative path semantics before applying constraints. |
| APOC-dependent implementation fails | Measured: zero APOC procedures in target image | Prohibit APOC as a dependency in the specification and acceptance criteria. |
| Unsourced memories become trusted by default | Measured: arbitrary Cypher can omit provenance | Show provenance ratio, trend, affected nodes, and remediation; visibly label unsourced material in app-composed context. |
| Provenance metric becomes decorative | Design risk | Tie health states to visible repair workflows and transparent context labeling. |
| Destructive or bulk-corrupt Cypher writes | Measured: write tool accepts arbitrary Cypher | Provide backup/export, restore, lifecycle inventory, and recovery documentation. |
| Credentialed mode silently changes tool behavior | Measured: `npx` version downgrade under allow-list | Verify executable resolution after narrowing; fail loudly; do not ship disclosure-only transition. |
| Ambient credentials leak into secret-bearing pane | Measured environment policy design | Keep allow-list model; do not pass Neo4j password through the non-secret channel. |
| Allow-list additions accidentally weaken isolation | Partly unverified which variables are required | Add variables only after measurement, scoped to specific launch requirements. |
| Secret written into third-party configuration | Standing project rule and prior incident | Preserve names-not-values rule; disable credentialed memory where compliant indirection is unverified. |
| Runtime secret exposure through agent or process inspection | Threat-model reasoning; runtime exposure inherent | Scope claims honestly; minimize injected secrets; treat secret-bearing panes as trusted code; maintain narrowed environment profile. |
| Cross-project graph access in shared instance | Measured arbitrary Cypher; Community cannot provide project databases | Retain per-project container isolation; do not substitute label namespacing for access control. |
| Excess RAM from always-running databases | Measured 512 MB–1 GB heap per container | On-demand start, idle shutdown, memory-pressure controls, and active-container limits. |
| MCP config exists but is unusable pending approval | Measured in Claude Code | Implement configured/pending/connected/failed states and user-facing approval instructions. |
| Other CLI approval and indirection behavior unknown | [UNVERIFIED] | Probe each target CLI before enabling credentialed memory or claiming automatic activation. |

---

# Recorded dissents and critique reconciliation

The following records are preserved. Commentary states whether each concern is well-founded.

## Structural dissent

- **[Structural — Q2]** Deepseek, GLM, and Grok supported advisory-and-measured provenance; Qwen qualified it.  
  **Finding:** Well-founded but not outcome-changing. The qualification improves the adopted position: advisory provenance is approved only with visible health, actionable repair, and transparent treatment of unsourced material in app-controlled context.

## Deepseek-v4-flash-0731 critiques

- **[Critique — R1, Q5]** Fixed “around five projects” is too absolute; limits depend on machine memory and active use.  
  **Finding:** Well-founded. The ruling uses active running containers and workstation-memory bands rather than a universal project count.

- **[Critique — R1, Q2]** User opt-out from using unsourced memories is too passive; poor provenance should have a stronger default consequence.  
  **Finding:** Partly well-founded. The ruling requires visible labeling and sourced-material preference in app-composed context, but rejects invisible or irreversible quarantine as inconsistent with advisory provenance.

- **[Critique — R1, Q3]** Broad deny-lists are weaker than measured allow-lists.  
  **Finding:** Well-founded. The ruling retains allow-listing as the default security model.

- **[Critique — R1, Q3/Q5/Q2]** The design should favor local mode, include backup/export/recovery, and distinguish new unsourced memories from historical backlog.  
  **Finding:** Well-founded. All three are incorporated into the rulings and action items.

- **[Critique — R1, Q2]** Hybrid constrained writes should not be dismissed entirely; they can improve canonical writes even if free Cypher remains.  
  **Finding:** Well-founded. The ruling permits constrained canonical creation as a quality path, while rejecting any claim that it achieves enforcement when unrestricted writes remain.

- **[Critique — R1, Q6]** A no-gate CLI should still provide clear notice before configuration is written.  
  **Finding:** Well-founded. The approval model should be capability-aware, but user-visible configuration disclosure remains appropriate even when immediate connection is possible.

- **[Critique — R1, Q3/Q2]** Require a persistent restricted-environment indicator and distinguish new unsourced material from backlog.  
  **Finding:** Well-founded. Both are adopted.

- **[Critique — R1, Q3/Q5]** The seven-variable list is untenable given the measured `npx` behavior; a shared instance remains unsafe under arbitrary Cypher.  
  **Finding:** Well-founded. The ruling rejects shipping the existing flip and rejects shared instances absent mediated access.

- **[Critique — R1, Q1/Q4/Q3]** APOC absence, unverified name-indirection support, and local mode preference were insufficiently emphasized.  
  **Finding:** Well-founded. These are explicit requirements in the findings.

## GLM 5.2 critiques

- **[Critique — R1, Q5]** Container thresholds need measured reasoning rather than personal comfort values.  
  **Finding:** Well-founded. The ruling derives conservative planning limits from measured heap demand plus total workstation overhead and treats them as adaptive operational limits.

- **[Critique — R1, Q1/Q5/Q2]** APOC absence, recovery capability, and provenance-sensitive context composition were omitted.  
  **Finding:** Well-founded. Adopted.

- **[Critique — R1, Q2]** Session-node stamping is underdeveloped and could create a false denominator if agents can ignore or delete it.  
  **Finding:** Well-founded. The ruling does not rely on session nodes as evidence of provenance unless an agent explicitly establishes meaningful source relationships.

- **[Critique — R1, Q3/Q1]** Command-resolution verification and stable repository identity require explicit treatment.  
  **Finding:** Well-founded. Adopted as preconditions for credentialed mode and schema constraints.

- **[Critique — R1, Q2/Q5]** Quarantining unsourced memories can become hidden enforcement, and created-container count is less meaningful than running-container count.  
  **Finding:** Well-founded. The ruling requires visible, reversible treatment of unsourced material and uses active container count as the principal operational signal.

- **[Critique — R1, Q1/Q3/Q2]** APOC, executable verification, measured allow-list requirements, and sourced retrieval weighting need inclusion.  
  **Finding:** Well-founded. Adopted.

## Grok 4.5 critiques

- **[Critique — R1, Q5/Q2]** Active-container bounds should be more conservative, and hybrid canonical writes remain useful even without full enforcement.  
  **Finding:** Well-founded. The ruling uses conservative three/five planning limits and preserves a limited role for constrained canonical writes.

- **[Critique — R1, Q1/Q5/Q4/Q2/Q6]** APOC absence, backup/restore, name-passthrough support, provenance trend, and explicit connection state need treatment.  
  **Finding:** Well-founded. Adopted.

- **[Critique — R1, Q3/Q2]** Quiet allow-list growth weakens isolation; prefer verification, visible restricted-profile status, local mode, and stronger provenance consequences.  
  **Finding:** Partly well-founded. The ruling allows narrowly measured allow-list additions only where necessary, rejects broad or quiet growth, and requires verification and visible status. It stops short of mandatory hidden exclusion of unsourced material.

- **[Critique — R1, Q1/Q3/Q5/Q6]** Stable worktree-aware identity, explicit confirmation, graph recovery, and actual-connected milestone gating need emphasis.  
  **Finding:** Well-founded. Adopted.

- **[Critique — R1, Q5]** A shared resource-saving mode should not become a soft default under resource pressure.  
  **Finding:** Well-founded. The ruling rejects it while unrestricted Cypher remains available.

- **[Critique — R1, Q3/Q4/Q1]** Verify-or-fail after environment mutation, probe each CLI’s compliant indirection support, and name APOC absence.  
  **Finding:** Well-founded. Adopted.

## Qwen 3.8 critiques

- **[Critique — R1, Q1]** Absolute paths should not be primary identity because they are machine-specific and mutable.  
  **Finding:** Well-founded. The ruling makes normalized repository-relative paths plus stable repository/worktree identity primary, with absolute paths as fallback metadata only.

- **[Critique — R1, Q1/Q5/Q4]** Destructive Cypher risk, recovery, APOC absence, and portability of name-only indirection need treatment.  
  **Finding:** Well-founded. Adopted.

- **[Critique — R1, Q3]** A deny-list is unsafe as default; allow-list additions must be measured and narrow.  
  **Finding:** Well-founded. Adopted.

- **[Critique — R1, Q1/Q5]** Worktree identity and destructive-write recovery need deeper treatment.  
  **Finding:** Well-founded. Adopted.

- **[Critique — R1, Q2]** Retrieval changes for unsourced memories must be visible, reversible, and not treated as proof of provenance; session stamping must not be mistaken for source evidence.  
  **Finding:** Well-founded. Adopted.

- **[Critique — R1, Q1/Q4]** Stable worktree-aware identity and universal CLI support remain unresolved.  
  **Finding:** Well-founded. The ruling treats both as preconditions rather than assumptions.

---

# Checkable action items

## Schema and graph integrity

1. **Define repository and worktree identity.**  
   Document the exact fields used to identify a repository, a worktree instance, a file, and a class; include normalization rules for paths and FQNs.

2. **Revise uniqueness constraints.**  
   Verify that uniqueness constraints use the documented stable identity model and cannot collide between simultaneously represented worktrees.

3. **Remove unsupported assumptions.**  
   Search the specification and implementation plan for APOC dependencies; record zero remaining required APOC procedures.

4. **Remove agent-authored confidence fields.**  
   Verify that no memory schema or UI presents agent-written numeric confidence as calibrated evidence.

5. **Define provenance relationships.**  
   Document the source, authoring agent, session, timestamp, and evidence relationship model, including which fields are required for a memory to count as sourced.

6. **Add graph recovery requirements.**  
   Define and test backup/export, restore, and deletion/recovery flows for each project graph.

## Provenance

7. **Implement a provenance-health calculation.**  
   Produce numerator, denominator, ratio, trend, new-unsourced count, historical backlog count, and affected-node list.

8. **Make provenance health actionable.**  
   Provide a visible “show unsourced memories” action and a repair workflow that can give an agent identified memories to inspect and repair.

9. **Make context treatment transparent.**  
   If app-composed context prefers or labels sourced material, show that choice to the user and provide a way to inspect included and excluded memories.

10. **Document enforcement boundaries.**  
    State explicitly that arbitrary Cypher means agent provenance is advisory; separately state which Chorus-originated operations require provenance.

## Credentialed mode and environment policy

11. **Keep local mode the default.**  
    Verify that local memory setup requires no Neo4j username or password and does not change the pane to the secret-bearing profile.

12. **Probe compliant credential configuration per CLI.**  
    For every supported agent CLI, establish by test whether it can reference a credential through an environment-variable name without storing the secret value in config. Disable credentialed memory for unsupported or unverified CLIs.

13. **Measure the narrowed environment per launch path.**  
    Test supported CLI and package-runner paths under the candidate allow-list, including cold-cache behavior.

14. **Add executable-resolution verification.**  
    Before launching a narrowed environment, verify that required commands resolve to approved executable paths and versions; fail visibly on unexpected substitution.

15. **Add an explicit credentialed-mode confirmation.**  
    Before enabling credentialed memory on a pane that previously inherited ambient environment, show the profile change, the dropped variables, the secret-bearing status, and local mode as an alternative.

16. **Add a persistent restricted-profile indicator.**  
    Verify that any secret-bearing pane visibly indicates its restricted environment status for the duration of the pane.

## Containers and lifecycle

17. **Implement on-demand lifecycle management.**  
    Start a project database on project open or focus, stop inactive containers after an idle policy, and expose running/stopped state.

18. **Add project-memory inventory.**  
    Show project, container state, last-used time, storage use, archive/delete options, and recovery information.

19. **Add memory-pressure behavior.**  
    Define and test warnings and inactive-container shutdown when active database count or available memory crosses configured thresholds.

20. **Set conservative active defaults.**  
    Use planning defaults of approximately three active containers on 16 GB workstations and five on 32 GB workstations, with adaptive adjustment based on measured available memory.

21. **Reject shared-instance mode until access is mediated.**  
    Record that label namespacing is not an isolation control under arbitrary Cypher; do not offer shared-instance mode unless a later design removes or mediates cross-project access.

## MCP approval and activation

22. **Implement connection state per agent/project.**  
    Expose `Configured`, `Pending approval`, `Connected`, and `Failed` states.

23. **Do not write approval state.**  
    Verify that Chorus writes MCP configuration only and does not modify third-party CLI approval or trust records.

24. **Provide approval guidance in-app.**  
    For pending agents, show the agent name, server identity, approval instruction, and re-check action.

25. **Gate “connected” status on actual usability.**  
    Mark a server connected only after an observed successful connection or probe read, not after configuration is written.

26. **Probe approval behavior per CLI.**  
    Establish whether each target CLI requires approval, and reflect actual behavior in the activation flow rather than assuming Claude Code behavior is universal.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members agreed
- **Q2** — detection: `structural` · members disagreed
- **Q3** — detection: `structural` · members agreed
- **Q4** — detection: `structural` · members agreed
- **Q5** — detection: `structural` · members agreed
- **Q6** — detection: `structural` · members agreed

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

## Dissents preserved

_25 preserved: 1 structural (computed from the members' own verdict tokens) · 24 from critique prose, from 4 members — Deepseek-v4-flash-0731 6 · GLM 5.2 6 · Grok 4.5 6 · Qwen 3.8 6._

_⚠ Read the per-member split before reading breadth into the total: several objections from one member is one member disagreeing repeatedly, not several members disagreeing. Nothing is dropped to make the total smaller._

- [Structural — Q2] Should provenance be advisory-and-measured — a validator that reports how many memories lack a source — rather than enforced by routing all agent writes through Chorus? — AGREE: Deepseek-v4-flash-0731, GLM 5.2, Grok 4.5 · QUALIFY: Qwen 3.8
- [Critique — R1] Deepseek-v4-flash-0731: The fixed “around 5 projects” threshold is too absolute; the real limit depends on machine memory and active use, not a universal number. The proposal to let users opt out of feeding unsourced memories back into context is too passive; the app should default to excluding or quarantining unsourced memories when the health threshold is bad, rather than waiting for user action. Also, switching to a broad deny-list is weaker than a measured allow-list, because a deny-list still exposes a large, harder-to-predict environment surface.
- [Critique — R1] Deepseek-v4-flash-0731: It does not consider biasing the default toward local mode to avoid the env flip altogether. It does not address graph backup, export, and recovery as a first-class requirement, even though arbitrary Cypher makes destructive or bulk-poisoning writes a major risk. It also does not distinguish new unsourced memories from historical backlog, which is necessary to see whether provenance quality is improving or worsening. ### Position B
- [Critique — R1] Deepseek-v4-flash-0731: The dismissal of a hybrid write path as mostly a compromise is too strong. A narrowly constrained, provenance-stamping write path for Chorus-originated writes and canonical memory types is worth having even while free Cypher remains; it does not need to be all-or-nothing. Also, the claim that a no-gate CLI would “degrade to immediate use” is acceptable only if the user still receives a clear pre-write notice; otherwise writing the config is effectively pre-authorizing connection through a different route.
- [Critique — R1] Deepseek-v4-flash-0731: It does not explicitly require a post-flip UI indicator that the pane is running under a restricted environment profile. It also does not distinguish new unsourced memories from historical backlog in the provenance metric, which would hide a worsening trend behind a flat total. ### Position C
- [Critique — R1] Deepseek-v4-flash-0731: Keeping the seven-variable allow-list as the default is untenable given the measured `npx` downgrade. The environment flip is acceptable only after the default allow-list is corrected to include `APPDATA`, `LOCALAPPDATA`, and any other variables established by measurement. Also, offering a shared instance later as an explicit “resource-saving mode” with only a disclaimer that it sacrifices project isolation is not safe while the arbitrary Cypher write tool remains; sacrificing isolation requires first removing or mediating arbitrary Cypher.
- [Critique — R1] Deepseek-v4-flash-0731: It does not mention the measured absence of APOC as a spec cleanup item. It also does not address the unverified question of whether other agent CLIs support environment-variable indirection in MCP config at all, which is a blocking implementability risk for “names not values.” It underuses local mode as the default path to avoid the env flip entirely.
- [Critique — R1] GLM 5.2: The Q5 thresholds (four on 16 GB, six on 32 GB) are stated as personal comfort levels without derivation from measured container heap behavior. Position B gives a clearer basis (~1 GB usable per container plus overhead) and arrives at more conservative numbers. The difference is small but the reasoning gap matters for a council document that others will implement from.
- [Critique — R1] GLM 5.2: No mention of APOC absence in the measured image (Position B raises this as a spec-editing risk). No mention of backup, export, or recovery paths for graph integrity under arbitrary Cypher (Positions B and C both raise this, and it is arguably the largest operational gap across the entire brief). No mention of weighting retrieval or context composition toward sourced nodes (Position B's most actionable Q2 suggestion for making measurement affect behavior rather than display). ### Position B
- [Critique — R1] GLM 5.2: The Q2 suggestion to "stamp what Chorus can control at session boundaries" with a session node is intriguing but underdeveloped. If agents write arbitrary Cypher and provenance is advisory, a Chorus-created session node becomes another thing agents can ignore, relabel, or delete. Introducing it as a "soft contract" without explaining how it survives hostile or confused writes could create a false denominator — the exact failure the position warns against elsewhere. The idea has merit but needs more defense before it belongs in the findings.
- [Critique — R1] GLM 5.2: No mention of command resolution verification after environment narrowing (Position A's unprompted observation). This is a directly relevant correctness concern given Position B's own emphasis on the `npx` downgrade. The stable `repo` identity point from Q1 is implicit in the composite-key discussion but never stated as an explicit additional correction the way Position A formulates it. ### Position C
- [Critique — R1] GLM 5.2: The Q2 suggestion to "quarantine unsourced memories" crosses from advisory into enforcement in a way the position itself warns against. Quarantine changes retrieval behavior based on provenance quality, which is closer to the app-mediated-write path the position says is "a larger product commitment and should not be treated as a minor refactor." Marking or flagging is defensible; quarantine implies a structural access change that the advisory posture does not support without the enforcement infrastructure the position rightly says is expensive. The warning threshold of fifteen created containers is arbitrary given that stopped containers have negligible resource cost — the real signal is running containers, which Position B frames more correctly.
- [Critique — R1] GLM 5.2: No mention of APOC absence (Position B). No mention of command resolution verification (Position A). Q3 does not mention expanding the allow-list to the variables the agent CLIs actually need (Position B's most concrete Q3 contribution). No mention of weighted retrieval or context composition as a behavioral lever for provenance quality (Position B). The stable `repo` identity point is raised but less concretely than Position A's formulation. ### CHANGED My position has not fundamentally changed — all three positions converge on the same core conclusions, which reinforces my confidence in them. However, three specific refinements from the council would strengthen my original position: 1. Command resolution verification (from A): I had not considered that environment narrowing could silently change which executable a command resolves to with exit zero. This is a correctness requirement, not a UX nicety, and I would now insist on pre-launch verification in any environment-flip implementation. 2. Backup and recovery for graph integrity (from B and C): My focus was on provenance and isolation. The point that arbitrary Cypher makes the graph mutable, destroyable state — and that provenance auditing is itself destroyable by a bad write — means backup/export/restore is not an operational afterthought but a prerequisite for the provenance system to function as designed. 3. Partial enforcement at Chorus-controlled boundaries (from C): The insight that Chorus can require provenance on its own writes, imports, and context composition — even while leaving agent writes advisory — is a middle path I had not articulated. It makes the advisory posture more defensible because it shows the app is not purely passive about provenance quality. These are refinements to implementation detail and scope, not reversals of judgment.
- [Critique — R1] Grok 4.5: The comfort bounds “~4 on 16 GB / ~6 on 32 GB” are slightly higher than a conservative assistive-feature budget once Docker + agents are counted; tighter active caps with earlier pressure warnings are safer. Treating hybrid as coherent only with read-only free-Cypher is right in spirit but understates a viable middle path: constrained provenance-stamping creates for canonical types while retaining free Cypher for advanced work, if app-surfaced context still treats unsourced as untrusted.
- [Critique — R1] Grok 4.5: APOC absence in Community image (spec must not depend on it). Backup/export/restore under arbitrary Cypher. Whether name-passthrough MCP config is universal across agent CLIs. Distinguishing new unsourced vs backlog in measurement. Explicit state machine Configured → Pending → Connected → Failed.
- [Critique — R1] Grok 4.5: Widening the allow-list with `APPDATA`/`LOCALAPPDATA` (or switching to a deny-list) as the primary fix for the `npx` downgrade weakens the secret-bearing profile’s isolation guarantee and fights the invariant. Prefer pre-enable disclosure of exact drops, verify-or-fail on resolved executables, visible restricted-profile indicator, and local mode as escape—not quiet allow-list growth. “Opt out of feeding unsourced back” is useful but weaker than default quarantine/exclude from app-composed context plus repair actions.
- [Critique — R1] Grok 4.5: Stable `repo` / absolute-or-worktree-qualified path identity (worktree collision). Explicit confirmation UX before environment flip (not only fix the list). Backup/remediation for agent graph destruction. Honest milestone gating on actual Connected, not only config written. Per-agent unsourced breakdown and new-vs-backlog trend.
- [Critique — R1] Grok 4.5: No material disagreement on substance. Minor: offering shared instance later as explicit resource-saving mode is acceptable only with very strong isolation-sacrifice warnings; should not be planned as a soft default under pressure.
- [Critique — R1] Grok 4.5: Concrete verify-or-fail after environment mutation (measured silent `npx` downgrade). Systematic probe of which agent CLIs support env-var name indirection in MCP config—the universality blocker for names-not-values. APOC absence called out as a hard spec constraint (implied by Community limits, not named).
- [Critique — R1] Qwen 3.8: I would not make absolute `File.path` a primary stable identity except as a fallback, because absolute paths are machine-specific and mutable; the safer fix is a stable worktree/repository-instance identifier plus a normalized repo-relative path, with absolute path only used when no stable identifier exists.
- [Critique — R1] Qwen 3.8: It did not sufficiently address the destructive-write risk created by arbitrary Cypher, including backup/restore or read/write separation, and it omitted the APOC-absence constraint and the unresolved question of whether all target agent CLIs support name-only environment indirection.
- [Critique — R1] Qwen 3.8: The suggestion that Chorus could switch to a deny-list that strips known credential variables is unsafe as a default because it fails open against unknown, renamed, or tool-specific secret variables; the allow-list should remain the default, and any additions such as `APPDATA` or `LOCALAPPDATA` should be justified by measurement and narrowly scoped.
- [Critique — R1] Qwen 3.8: It did not address the worktree/repo identity problem deeply enough, especially how `(repo, path)` remains ambiguous without a stable worktree identifier, and it gave insufficient attention to recovery from destructive agent Cypher such as snapshots, export, or separated read/write tools.
- [Critique — R1] Qwen 3.8: Retrieval weighting against unsourced memories should not be a silent default; if unsourced memories are downweighted or excluded, that behavior must be visible, reversible, and preferably user-configurable, otherwise advisory measurement becomes hidden enforcement; session-node stamping also must not be treated as provenance unless the agent explicitly links to it with a meaningful source edge.
- [Critique — R1] Qwen 3.8: It still underweights the need for a stable, worktree-aware repository identity and normalized file identity to make composite keys collision-free, and it does not fully resolve the portability question of name-only environment variables across agent CLIs, even though it notes one measured CLI supports passthrough.

## Provenance

- **Run id:** `41c80955-9545-4078-be89-9f7365384803`
- **Started:** 2026-08-08T00:02:14.282Z

| Member | Role | Model | Turns |
|---|---|---|---|
| Deepseek-v4-flash-0731 | member | `deepseek/deepseek-v4-flash-0731` | answered 2 turns |
| GLM 5.2 | member | `z-ai/glm-5.2` | answered 2 turns |
| Grok 4.5 | member | `x-ai/grok-4.5` | answered 2 turns |
| Qwen 3.8 | member | `qwen/qwen3.8-max` | answered 2 turns |
| GPT 5.6 Terra | arbiter | `openai/gpt-5.6-terra` | answered 2 turns |


# Phase 11 council disposition

Recorded 2026-09-20 before production feature edits. [Original findings](CouncilBrief-11.0-TeamAuthority-Findings.md), run `8f16eb53-6f8c-414a-b13f-589df5fe79c9`, started 18:02:34 UTC and completed 18:16:02 UTC. Reported cost $0.737063; the service's accounting metadata remains authoritative.

The existing Chorus council workflow ran in a separate disposable profile using the configured members, arbiter, and encrypted credential records. No project sessions were restored. Its boot log records zero key revocations. The first isolated-profile attempt lacked the encrypted wrapping-key metadata and refused before spending; after supplying that encrypted metadata the real run completed.

**Partial review:** three of four deliberating members answered; GLM 5.3 returned an empty position, and Qwen's initial position was incomplete. The complete findings preserve those limitations and dissent. The plan requires a recorded council run/disposition, not unanimity or a specified quorum. This review is accepted as input with its limitations; no runtime gate is waived and no unanimous approval is claimed.

## Decisions and ownership

| Ruling | Disposition and rationale | Contract / task owners | Required evidence and status |
|---|---|---|---|
| Q1 credential authority | Adopt fenced authorization, explicit normal/recovery modes, immediate pausing denial, credential fingerprint/route recheck, and post-spawn race containment. Existing attempt reservation remains; add a final synchronous fence after any awaited decrypt. | Feature §10; 11-2, composition 11-4, recovery 11-5 | Stop/Pause/rotation/deletion races; zero team credential resolution, lease issuance and process launch at boot. Specified, implementation pending. |
| Q2 broker | Adopt structural endpoint/route validation, per-call run/generation/epoch/mode checks, HTTP limits, active wait disconnection, external configuration and two-client conformance evidence. | Feature §10; 11-1/11-2/11-4 | Malformed URL/frame, authentication, version negotiation, stale token, cancellation, slow connection and configuration-preservation tests. Preliminary probes recorded separately; full gate open. |
| Q3 permissions | Adopt explicit eligibility and structured permission blockers. Retain native edit-denial requirement for analysis; post-hoc detection is additional evidence, not an alternative. | Feature §10; 11-1/11-2, UI 11-4 | Code/test and denied-edit probes, unattended denials, recursive-tool suppression, unknown-prompt timeout handling. Pending complete matrix. |
| Q4 identity | Adopt reserved capture identity and real-Git tests; retain existing exact approval tuple and integrated verification. | Feature §10; 11-2/11-3/11-5 | Source/index hashes, manifests, stale approvals, dirty/conflicted trees, each Git publication boundary. Pending. |
| Q5 durability | Adopt capture operation reservation before Git writes and identity-bearing commit metadata/ref reconciliation. The original plan already reserves attempts before preparation; clarify rather than introduce a second attempt identity. | Feature §10; 11-2 storage, 11-3 Git, 11-5 reconciliation | Interrupt after reservation/object/ref/publication; reconcile exact known identities; never substitute an attempt. Pending. |
| Q6 lifecycle | Adopt generation increment on every Resume/replacement, old connection revocation, explicit pausing allowlist, and ordinary CRUD/restore guards. | Feature §10; 11-2/11-4/11-5 | Pausing tool matrix, replacement handoff, zero team boot activity, ownership refusals, observed Stop-during-promotion outcome. Pending. |
| Q7 measurement | Adopt exact test command/outcome/context/source identity, provenance, approval-wait accounting, coverage subsets, and limited benchmark claims. | Feature §10; 11-2 evidence types, 11-3 review, 11-4 display, 11-5 evaluation | Same acceptance depth in both modes, 18 retained outcomes, nullable spend and subscription estimates labeled. Pending. |

## Clarifications and rejected absolutes

- JavaScript strings cannot promise reliable zeroization. Drop secret references promptly, bound their lifetime, scrub retained output, and never claim memory erasure. Reject only the absolute zeroization wording, retaining its secret-lifetime intent.
- Process observation is not omniscient. Require confirmed exit of recorded/observed owned processes and fail closed on unverifiable descendants/writers. Keep the stated same-user/cooperative trust boundary.
- A hung process alone cannot prove a permission prompt. Emit `permission-blocked` only from documented structured denial evidence; otherwise terminate at the deadline and report timeout with unknown cause. Do not infer success or denial from terminal prose.
- Subscription selection means the CLI's current authenticated account, explicitly identified as CLI-managed. Multiple independently selectable subscription accounts are disabled unless an installed-version probe proves a per-launch identity mechanism. Do not copy CLI authentication files.
- The no-boot-decryption assertion covers **team authorization and team credential resolution**. It does not silently remove the existing unrelated management-key attribution reconciliation service.
- The broker is a private HTTP protocol behind stdio, so MCP clients do not append HTTP routes. Adopt a finite broker-advertised route allowlist; a single current route is valid and no arbitrary path forwarding is allowed.
- Permission behavior, HTTP limits and crash tests are implementation/release obligations. Requiring finished implementations before writing their tested implementation would be circular. The council gate is discharged by this recorded disposition and the normative/task amendments; Task 11-1 remains the separate gate before runtime adoption.

No scope requirement, dependency restriction, integration approval, or compatibility/release gate is removed. Production implementation may now begin with Task 11-1.

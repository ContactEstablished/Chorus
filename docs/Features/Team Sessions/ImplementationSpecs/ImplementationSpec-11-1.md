# Implementation specification 11-1 — Compatibility and helper adapters

Paired [task](../Tasks/Task-11-1.md). Normative [feature contract](../chorus-team-sessions-spec.md). **Implemented; measured compatibility gate passed 2026-09-20. See [evidence and exclusions](../Compatibility-Report.md).**

## Ownership and insertion points

Create `src/main/adapters/helpers/types.ts`, `registry.ts`, `claude.ts`, `codex.ts`, `opencode.ts`, plus colocated tests. Do not repurpose the existing interactive `buildLaunch` entry points or widen AgentKind. The helper registry is keyed by existing harness IDs and publishes capabilities to TeamService; the renderer never invents support from a provider name.

Add `src/main/adapters/teamLead.ts` with a capability-gated per-launch MCP configuration descriptor for Claude/Codex leads. Prove configuration outside the worktree; Claude's installed help advertises `--mcp-config`, but live behavior still requires this gate. Codex uses its verified launch override path. Do not mutate global/project files to work around failure.

Create `resources/teamBridge.cjs` as a standalone Node script, and `scripts/verify-team-compatibility.mjs` as the fixture/live harness. Task 11-4 owns packaging it and production MCP composition. Task 11-2 owns the broker and common domain schema. No new dependency or installed CLI modification is part of this task.

## Adapter interface

Expose these proposed interfaces from helpers/types.ts; reuse existing route/credential types by type-only import where compatible:

```ts
interface HelperAdapter {
  id: 'claude' | 'codex' | 'opencode'
  probe(signal: AbortSignal): Promise<HelperCapabilities>
  buildExecution(input: HelperExecutionInput): HelperLaunchRequest
  createParser(): HelperEventParser
}
```

Capabilities describe installed version, auth modes, model routing, structured format, unattended permission behavior, cancellation/process-tree behavior, and native-subagent control with verified/unsupported/unverified status and reasons. A version change invalidates version-specific evidence until a lightweight probe rechecks it. Keep the compatibility report's tested combinations distinct from unverified catalog entries.

Execution input contains attempt ID, verified cwd, member configuration, exact task brief, code/analysis intent, resolved selected credential, and run cancellation signal. Launch request contains executable, argv array, cwd, non-secret environment additions, secret environment map, stdin payload, parser kind and native permission configuration. Send the task brief on stdin when supported. If a CLI requires a prompt file, create an app-owned per-attempt file with restricted lifetime; never place keys in that file or the command line. The probe determines and records the supported input form; never concatenate arbitrary prompts into shell syntax.

Normalized events: started (optional vendor session ID), activity (sanitized text/tool category), usage (nullable counts/source), permission-blocked, result (summary/checks/error flag), and protocol-error. Process exit is a separate executor event. Both a valid terminal result and confirmed process-tree termination are needed for successful completion. Provider success text cannot override a nonzero failure, cancellation, or timeout.

## Installed-version verification

Inspect `--version` and relevant `--help` on the installed binaries. Starting surfaces are Claude programmatic structured output, Codex `exec --json`, and opencode `run --format json`; verify stdin, model, effort, cwd and permission flags before encoding them. Use [Claude docs](https://code.claude.com/docs/en/headless), [Codex docs](https://learn.chatgpt.com/docs/non-interactive-mode), and [opencode docs](https://opencode.ai/docs/cli/) as primary references.

Subscriptions remain CLI-managed; no copied auth files, scraped session tokens or unofficial API reuse. API helper probes use only the selected vault/env route. Verify external-model compatibility through opencode's supported provider routing, not Codex's Responses-only route assumption. Any route requiring unsupported translation remains disabled.

Verify analysis tools cannot edit through the chosen mode; if they can, analysis mode is unavailable for that adapter and model. Code mode must either execute the bounded local task or return a permission blocker without invisible interactive input. Do not use bypass/full-access flags as an automatic fallback. Record native subagent suppression behavior and label any cooperative restriction honestly.

## Stdio facade and fixture broker

The bridge uses Node built-ins, UTF-8 newline-delimited JSON-RPC, protocol 2025-06-18, and tools capability only. Implement initialize/initialized lifecycle, ping, tools/list, tools/call, and cancellation of outstanding wait requests. Negotiate the documented supported version; no calls before initialization. Invalid JSON, unsupported methods and bad parameters return proper protocol errors. Do not reply to notifications as requests. A tool-domain failure is an MCP tool result with `isError`, not a successful result containing a hidden failure.

The facade obtains endpoint and authorization from `CHORUS_TEAM_ENDPOINT` and `CHORUS_TEAM_TOKEN`. Require an exact 127.0.0.1 host and valid ephemeral port; disallow redirects. Every private broker request carries the token in a header. Do not forward arbitrary client URLs/headers. The broker supplies tool schemas, preventing a second domain schema in this script. Return bounded textual JSON tool results; tools/list is fixed for a run.

Support partial input chunks, escaped newlines and multiple requests; bound an individual frame/body to 1 MiB and pending calls to 32. Respect output backpressure. Keep stderr generic and scrubbed; stdout contains protocol messages only. EOF cancels outstanding waits and closes. Cancelling a wait never cancels the underlying task. Reject non-loopback destinations before any network request.

The fixture harness implements the same broker envelope with deterministic fake work. Live mode creates/uses only a designated disposable Git fixture, starts the actual leads with launch-scoped MCP configuration, and exercises the real helper adapter requests. Store sanitized logs and versions in a user-selected evidence folder outside the project. Never rewrite global CLAUDE.md, AGENTS.md or provider configuration.

## Test/proof matrix

- Fixture: split/oversized/malformed frames, initialize negotiation, unknown methods, duplicate request IDs, revoked token, unavailable broker, cancellation, stderr and backpressure.
- Adapters: split UTF-8/JSON events, unknown informational events, missing final result, in-band error, invalid structured completion, command paths with spaces, Windows shim escaping, selected credential only.
- Real runs: each lead delegates two concurrent tasks; one code helper changes a fixture file and runs its test; another reports independent analysis. Demonstrate result collection, counted revision, cancelled work and no lingering descendant writes.
- Authentication: native subscription paths for Claude/Codex and an API-backed external provider through opencode. Prove API-key variants for the native helpers where exposed; unsupported variants remain disabled, not guessed.
- Bridge resources: verify Node is a detected prerequisite, record the Node minimum used by the script, and hand 11-4 an absolute dev/packaged path resolver contract.

## Gate, failures and handoff

Produce `Compatibility-Report.md` with actual versions, resolved executables, non-secret launch forms, model/provider/auth combinations, protocol evidence, permission behavior, cancellation evidence and explicit failures. Do not include raw process environments or subscription files. Both leads and all three helper harnesses are required; unproved capability keeps the gate open. Separate a missing local credential from an architectural incompatibility.

Pass helper interfaces, event fixture captures, bridge invocation contract and excluded generated-config paths to 11-2/11-3/11-4. Commit only task-owned implementation/evidence after required checks; no task commit or runtime success is claimed by this planning document.


## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is still pending.

Capture native permission-denial evidence, analysis edit prevention, supported CLI-managed subscription identity scope, external launch configuration preservation, per-route metering provenance, both clients’ negotiated MCP revision/approval behavior, stdout purity, bounded frames, and wait cancellation. Apply the endpoint/resource limits in feature §10 to the facade. Record the measured Windows sandbox and PATHEXT requirements. Keep all unproved combinations disabled; diagnostic print/exec probes are not interactive lead proof.

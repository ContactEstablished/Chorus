# Task 6-5 — RESULT: the Phase 6 milestone is MET

_Driven 2026-08-14 against `main` at `fc93937`, dev build, codex 0.147.0 / claude 2.1.232 / opencode 1.18.18. Answers `Task-6-5-Handoff.md`, whose only outstanding item was the live G2 test. Evidence under `_verify/6-5/`._

> ## ✅ **MILESTONE MET.** A real `claude` session reached a real Neo4j through the Chorus-written MCP config and answered a query from the graph.
>
> The handoff's standing warning — *"a config file existing is not the milestone"* — is discharged by an **observed tool call**, not by a file listing.

---

## 1. The milestone, as observed

Asked in the `Claude Code - Lois` pane (screenshot `11-MILESTONE.png`):

> Using the chorus-memory MCP server, look up the Memory node whose key is `'chorus-g2-probe'` and tell me its note text.

The pane's own transcript:

```
● I'll load the Neo4j MCP tool schema first, then query for that node.
  Called chorus-memory
● The node exists. Its note text is:
  │ The milestone canary for Task 6-5
  Full node: { key: "chorus-g2-probe", note: "The milestone canary for Task 6-5" }
  — those two properties are all it carries.
```

**`Called chorus-memory` is the load-bearing line.** It is the tool invocation, so the answer came from the database rather than from the model — and the canary string existed only in the container the operator had seeded by hand minutes earlier.

## 2. Evidence, gate by gate

| Gate | Result |
|---|---|
| Chorus → Neo4j probe | `{ ok: true, probe: 1 }` against `bolt://127.0.0.1:7688` |
| Schema applied | `identity-constraints-and-indexes`, `from_version: 0 → to_version: 1` |
| claude's `.mcp.json` | written at the **project root** (current-tree launch), `uvx` + `mcp-neo4j-cypher`, `NEO4J_URL` + `NEO4J_DATABASE` |
| opencode's config | `%APPDATA%\chorus\mcp\opencode.json` — `mcp` / `type: "local"` / single `command` array / `environment`, exactly the measured dialect |
| **codex `config.toml`** | **byte-identical before and after: `ec0fde13b44c…`** — argv-only, observably true |
| **Written-file secret grep** | **NO MATCHES** over `.mcp.json` and `%APPDATA%\chorus\mcp\` — the grep `npm run grep:secrets` structurally cannot reach |
| claude's final view | `chorus-memory: uvx mcp-neo4j-cypher - ✔ Connected` |
| Approval record | `enabledMcpjsonServers: ["chorus-memory"]`, written by **claude** in response to the operator's keystroke |

**No secret exists to leak, by construction:** local mode carries no credential, so the guard ran over bytes that should contain none — which makes a match a loud failure rather than a near-miss.

> **⚠ THE `config.toml` BASELINE IN THE HANDOFF WAS STALE AND WAS RE-BASELINED BEFORE THE RUN.** It recorded `e791bda3…` on 2026-08-10; the live file was `ec0fde13…` before Chorus was launched. **codex writes that file itself** (hook trust, account state), so the four-day-old value would have "detected" a change Chorus did not make. The comparison above is against the value measured minutes before launch.

## 3. ⚠ The detour, and it is the most reusable thing here

`chorus-memory` was initially **invisible** to claude — not `⏸ Pending approval`, simply absent from `claude mcp list` and from `/mcp`.

**Cause:** the repo's `.claude/settings.local.json` contained `disabledMcpjsonServers: ["chorus-memory"]`.

**How it got there:** the driving session first launched the panes through Chorus's **IPC directly** rather than through the launch dialog. That created real sessions with real PTYs — the config files prove they launched — but **no visible panes**, because an IPC launch bypasses the renderer's pane bookkeeping. claude's trust prompt therefore fired where nobody could answer it, and killing those sessions recorded a **rejection**.

**Why it cost time:** a rejected `.mcp.json` server does not degrade to "pending" — it **vanishes entirely** from both `claude mcp list` and `/mcp`. The observable state is identical to *"Chorus never wrote the file"*, which is precisely the wrong conclusion, and the file was sitting on disk and correct the whole time.

**How it was settled — a clean A/B rather than a guess:** the identical `.mcp.json` copied to a neutral scratch directory listed as `⏸ Pending approval` immediately. That isolated the fault to the project's recorded choice rather than the file, the writer, or the CLI version.

**Remediation, and the bright line held:** `claude mcp reset-project-choices` — the CLI's own documented command, which clears recorded choices and **does not approve anything**. The blast radius was checked first (`enabled` empty, `disabled` holding only `chorus-memory`) and the file copied to `_verify/6-5/settings.local.json.before`. **The settings file was never hand-edited**, per the handoff's explicit warning, and **the approval itself was performed by the operator**, never by Chorus and never by the assistant.

## 4. What was NOT driven, stated plainly

- **opencode was not driven to a query.** Its config was written and verified on disk in the correct dialect, but no opencode session was asked the canary question. **The milestone does not depend on it** (it is met by claude), but the acceptance criterion that mentions opencode is **NOT RUN**.
- **⚠ codex DOES NOT RECEIVE THE SERVER AT ALL — CORRECTED 2026-08-14 AFTER DRIVING IT.** This section first read *"its evidence is negative-by-design: `config.toml` unchanged, server delivered as argv"*. **The first half is true and the second half was never measured — it was read off the design.** Driven afterwards, a codex pane answered: *"The current Codex session only exposes the node_repl MCP server; **chorus-memory is not registered**."* The process command line confirms it — Chorus's codex launches carry `-c tui.status_line=…` and `-c developer_instructions=…` and **no `mcp_servers.*` argv whatsoever**. **See F75.** The acceptance criterion *"codex receives it as launch argv"* is **NOT MET**. `config.toml` is still byte-identical, so the D49 half stands.
- **The four-state model (D126 Q6) is still only partly driven**, exactly as the handoff recorded. `Configured` and `Connected`/`Failed` are real and describe **Chorus's own** connection; there is still no per-agent state, deliberately.

## 5. New findings

- **F73 — a trust prompt fired in a pane nobody can see becomes a silent REJECTION, and a rejected `.mcp.json` server disappears rather than degrading to pending.** See §3. Two consequences worth carrying: (a) **launching sessions through IPC rather than the launch dialog creates PTYs with no visible pane** — a real hazard for any automated driving of this app, and the thing that caused this; (b) **the rejected state is indistinguishable from "no config was written"**, so anyone debugging it will suspect the writer first and be wrong. The A/B against a neutral directory is the cheapest way to separate the two.
- **F74 — `last_seeded_at` is not stamped after a successful seed.** `memory:seed` returned `{ ok: true, from_version: 0, to_version: 1, applied: ['identity-constraints-and-indexes'] }` and `updated_at` moved, but `last_seeded_at` remained `null` on the following `memory:get`. Cosmetic today — nothing reads it — but it is the field a UI would use to say *when* the schema was last applied, and it would read "never" forever.
- **`cache_was_stale: true` is the system working**, recorded so it is not mistaken for a defect: Chorus's cached `schema_version` said 1 while the fresh container was at 0, and the seeder corrected itself rather than trusting the cache.

## 6. Still open, and deliberately not fixed here

- **`.mcp.json` is NOT gitignored** and is untracked in the repo right now. **⚠ Do not simply delete it — it is what makes the memory integration work**, and it is now approved. The decision is whether the repo should ignore it; it is one careless `git add .` from being committed. Raised by the handoff, still yours.
- **opencode's config is one file per app, not per project**, rewritten at every launch. Two *live* opencode sessions in different projects share it. Documented at the method.
- **Stage 5 is untouched** — Docker provisioner, `skill.yaml`, `index-codebase`. Chorus never started the G2 container and never stops it; that is Stage 5's job and Stage 5 is not built.

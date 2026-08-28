# Task 1-1 — The registry reader core (pure)

**Phase:** Fleet Comms 1 · **Depends on:** None · **Owns:** `src/main/services/fleetRegistryCore.ts`, `src/main/services/fleetRegistryCore.test.ts`

---

## Source Of Truth

- `docs/Features/Fleet Comms/chorus-fleet-comms-spec.md` — **§4.1** registry shape, **§4.6–4.8** why
  the address moves, **§6.1** the addressing rule (binding), **§8.1** the read contract.
- `docs/Features/Fleet Comms/Tasks/Phase-1-Overview.md` — verified facts, decisions, gates.
- `docs/Features/Foundation/roadmap.md` §6 **D182**.
- Convention to follow: `src/main/services/agentEventsCore.ts`, `codeIndexCore.ts`, `resumeCore.ts`
  — this repo puts the decidable logic in a pure `*Core.ts` and tests it without I/O.

## Initial Starting Point (verified 2026-08-27 at `07708c8`)

- **No fleet code exists.** `src/main/services/` contains no `fleetRegistry*` file.
- `WORKING_STALE_MS = 45_000` (`agentEventsCore.ts:317`) and `OUTPUT_STALE_MS = 10_000` (`:362`) are
  exported and will be *compared against* in Task 1-2 — this task does not touch them.
- Phase 0's `toPeerAddress` lives at `src/shared/agentNames.ts:110`.

## Goal

Author the pure decision layer for fleet awareness: parse and validate a registry entry, decide
whether an entry is live given process facts supplied by the caller, gate on protocol version,
detect duplicate names among live entries, and derive a pane's **address state** from what was
requested versus what the registry currently says. No filesystem, no timers, no process
inspection, no logging — all of that is Task 1-2.

## Exact Scope

Create exactly two files:

- `src/main/services/fleetRegistryCore.ts`
- `src/main/services/fleetRegistryCore.test.ts`

Touch nothing else.

## Non-Goals

- **No I/O of any kind** — no `fs`, no `child_process`, no `setInterval`, no `logger`. If a function
  needs the time or a process list, it takes it as an argument.
- **No Zod in a renderer-reachable path.** This module is main-only; validation lives here per D1
  (all Zod in main).
- No IPC schema, no channel, no store, no component.
- No reading of `.key` files, and no use of `messagingSocketPath` beyond carrying it as an opaque
  string.
- **Do not persist or key on `name`** — the type must make it awkward to.
- Do not revert or commit `.mcp.json`.

## Dependencies

None. This task can start immediately and is the only one that can be written without the others.

## Step-by-step Work

1. **Define the validated entry.** A Zod schema for a registry file's contents, tolerant of unknown
   keys (the CLI adds fields; see `peerFeatures` arriving after `peerProtocol`). Required for use:
   `pid`, `sessionId`, `cwd`, `procStart`, `peerProtocol`, `name`, `status`. Optional and carried:
   `messagingSocketPath`, `nameSource`, `nameSince`, `startedAt`, `version`, `entrypoint`.
2. **`parseRegistryEntry(raw: unknown): ParseResult`** — returns a discriminated result, never
   throws. A malformed or torn file is a *value* (`{ ok: false, reason }`), because §8.1 requires a
   tolerant read that degrades to `unknown` rather than crashing a poll.
3. **`isProtocolSupported(entry): boolean`** — `peerProtocol === 1`. An unrecognised value is not an
   error; it is "degrade and log once", and the caller owns the logging.
4. **`isLive(entry, probe): boolean`** — `probe` supplies `{ pid, startTime }` facts the caller
   gathered. Live requires the pid to exist **and** its true start time to match the entry's
   `procStart`. A pid match alone is insufficient (§4.7: files outlive processes; pids recycle).
5. **`duplicateNames(entries): ReadonlySet<string>`** — normalised (trim + case-fold) names held by
   more than one live entry. This is the only evidence Chorus has for a *collision* cause.
   *(Corrected 2026-08-27 during implementation: this said `Map<string, Entry[]>`, which contradicted
   `addressStateFor`'s `duplicates: ReadonlySet<string>` in the paired spec. The only consumer asks a
   membership question; widen it when something needs the holders, not before.)*
6. **`addressStateFor({ requestedName, entry, duplicates }): AddressState`** — the heart of the
   task. Returns one of exactly three:
   - `verified` — a live entry matched and its `name` equals `requestedName`
   - `changed` — a live entry matched and its `name` differs; carries `requested`, `current`, and an
     optional `cause` (`'collision'` only when `duplicates` proves another live entry holds the
     requested name; `'title'` is **not** derivable here and is left for a future signal)
   - `unknown` — no matching live entry, unparseable data, or unsupported protocol
7. **Stickiness is a pure fold, not a timer.** `nextStickyState(previous, incoming)` — once a state
   becomes `changed`, a later `verified` does **not** silently overwrite it; it produces a state
   that still records the transition until explicitly acknowledged. Model acknowledgement as an
   input, not as elapsed time. Council FC-1.0 Q1 (unanimous) and DeepSeek's dissent both require
   this; a one-poll badge "will look like a silent rename to anyone who blinked".

## Test Expectations

New file `fleetRegistryCore.test.ts`. Cover at minimum:

- A real registry entry (copy the §4.1 shape verbatim) parses.
- Unknown extra keys parse; a missing `pid` or `sessionId` fails as a **value**, not a throw.
- Truncated JSON, empty string, `null`, an array, and a number all return `{ ok: false }`.
- `peerProtocol: 2` and a missing `peerProtocol` are both unsupported.
- `isLive` is false when the pid is absent; false when the pid exists but `procStart` differs
  (**the recycled-pid case — assert it explicitly**); true only when both match.
- Two live entries holding `Zeta` are reported as duplicates; case and surrounding whitespace do not
  hide a duplicate.
- `addressStateFor` returns `verified` / `changed` / `unknown` across: names equal; names differ;
  names differ **and** another live entry holds the requested name (`cause: 'collision'`); no
  matching entry; unparseable entry; unsupported protocol.
- **Stickiness:** `changed` → later `verified` does not silently return to plain `verified`;
  an explicit acknowledgement does clear it.
- ⚠ **A test that asserts three states exist and no fourth** — the state union is the contract this
  phase's UI is built on, and the council proposed six.

## Verification Commands

```
npx vitest run src/main/services/fleetRegistryCore.test.ts
npm run typecheck
```

Junction `node_modules` first (Phase-1-Overview §6), remove it afterwards.

## Acceptance Criteria

- Both files exist; no other file in the repo is modified.
- The purity check passes. ⚠ **Strip comments before checking** — the file's own header names `fs`,
  `electron` and `better-sqlite3` while explaining that it uses none of them, so a plain grep
  matches its own prose and reports a pure file as impure. *(Corrected 2026-08-27: the criterion
  here was that plain grep, and it produced exactly that false positive on first run — the same
  self-matching trap the roadmap's `full-access` check fell into.)*

  ```
  node -e "const s=require('fs').readFileSync('src/main/services/fleetRegistryCore.ts','utf8');const code=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');const bad=['node:fs','child_process','setInterval','logger','electron','better-sqlite3','Date.now','Math.random','process.'];const hits=bad.filter(b=>code.includes(b));console.log(hits.length?'IMPURE: '+hits.join(', '):'CLEAN')"
  ```
- The exported state union has exactly three members.
- Full suite still at its baseline or higher: **82 files / 3015 tests**, all passing.
- `npm run typecheck` → 0 errors.

## Review Checklist

- [ ] Every exported function is pure — same inputs, same output, no ambient reads.
- [ ] A malformed file is a value, never a throw. There is no code path where one bad file in
      `~/.claude/sessions/` can end a poll.
- [ ] Liveness genuinely requires `procStart`, and a test proves the pid-alone case fails.
- [ ] Nothing persists, keys on, or indexes `name`.
- [ ] `messagingSocketPath` is carried but never parsed, opened, or interpreted.
- [ ] The three-state union is closed, and the code says why six were rejected.
- [ ] Stickiness is expressed as a fold over states, with acknowledgement as an input — not as a
      timestamp comparison.

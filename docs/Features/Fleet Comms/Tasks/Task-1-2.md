# Task 1-2 — The registry service: polling, liveness, `v23`, and the disagreement log

**Phase:** Fleet Comms 1 · **Depends on:** Task 1-1 · **Owns:** `src/main/services/fleetRegistry.ts` (+ test), the `MIGRATIONS` array and `peer_sessions` accessors in `storage.ts`, the `peer_sessions` table in `schema.ts`, the wiring lines in `src/main/index.ts`, and the dedupe call site in the name-suggestion path

---

## Source Of Truth

- Spec **§4.1** (registry shape), **§4.7** (files leak), **§8.1** (poll contract), **§8.2** (status
  comparison), **§9** (storage split).
- `Tasks/Phase-1-Overview.md` §3 **D1** (persist now, `v23`) and **D2** (no `chorus-` prefix).
- `ImplementationSpecs/ImplementationSpec-1-2.md`.
- Precedent to copy: `src/main/services/attention.ts` — the app's single-`setInterval` rule is
  stated at `:89` and the timer lives at `:150`.

## Initial Starting Point (verified 2026-08-27 at `07708c8`)

- `MIGRATIONS: string[]` is declared at `storage.ts:175` and spans **824 lines**; the highest `// vN`
  marker in it is **v22**. Each entry is raw SQL preceded by a comment block that states the
  reasoning and, per the v22 entry's own text, records that **the number was computed, not copied**.
- `getSessionById(id): SessionRow | null` exists at `storage.ts:1777`.
- `agentEvents.onTranscriptPath((sessionId, transcriptPath) => {` is at `src/main/index.ts:651` —
  this is where main already learns a claude session's `sessionId`, and it is the join key.
- `WORKING_STALE_MS = 45_000` (`agentEventsCore.ts:317`) and `OUTPUT_STALE_MS = 10_000` (`:362`).
- `suggestAgentName(taken, random)` is at `src/shared/agentNames.ts:71` and takes names already used
  **in this project**.

## Goal

Stand up the main-process fleet reader: poll `~/.claude/sessions/*.json` on an interval and on pane
lifecycle events, validate and liveness-check every entry through Task 1-1's pure core, join live
entries to Chorus panes by `sessionId`, persist the `messagingSocketPath` → `sessionId` mapping, and
log where the registry's own `status` disagrees with what Chorus computes. Expose the result in
memory for Task 1-3 to serve over IPC. **Change no existing behaviour.**

## Exact Scope

- **Create** `src/main/services/fleetRegistry.ts` and `src/main/services/fleetRegistry.test.ts`.
- **Edit** `src/main/services/storage.ts` — append migration `v23`; add `upsertPeerSession` and a
  reader.
- **Edit** `src/main/db/schema.ts` — declare `peer_sessions` to match the DDL exactly.
- **Edit** `src/main/index.ts` — construct and start the service; stop it on quit.
- **Edit** the name-suggestion call site so live registry names count as taken (**D2's surviving
  half** — the prefix is declined, the dedupe is not).

Nothing else.

## Non-Goals

- **No IPC channel, no preload change, no renderer file.** Task 1-3 owns the wire.
- **No change to the activity light.** Spec §8.2 is explicit — the existing path covers every
  adapter, the registry covers one, and swapping trades breadth for accuracy. **This task adds a log
  line and nothing else.** If you find yourself editing `agentEvents.ts` behaviour, stop.
- **Never open `messagingSocketPath`.** It is stored and compared as an opaque string. **Never read
  a `.key` file** — do not even `readdir` for them.
- No `chorus-` prefix on suggestions (D2).
- No persisting of `name` anywhere, in any table, in any column.
- Do not revert, stage, or commit `.mcp.json`.

## Dependencies

Task 1-1 must be merged — this task imports its parser, `isLive`, `duplicateNames`,
`addressStateFor` and `nextStickyState` rather than reimplementing any of them.

## Step-by-step Work

1. **⚠ GATE G-B FIRST — compute `v23`, do not copy it.** Run the roadmap's G6 procedure in full
   before writing a line of SQL: parse the `MIGRATIONS` array on **every branch and worktree** in
   the repository, and cross-check the dev DB's own `SELECT MAX(version)`. Record the numbers you
   saw in the commit message. The roadmap records D148 colliding on a merge, and this session
   watched `origin/main` claim D181 while this branch was open.
2. **Author migration `v23`** creating `peer_sessions` (DDL in the spec doc), with a comment block
   in the array's house style stating the reasoning **and D1's argument for persisting now**: the
   socket hash is not derivable from the `sessionId`, so a sender that exits while nothing records
   the mapping is unresolvable forever. Mirror the DDL exactly in `schema.ts`.
3. **Write the process probe, and VERIFY THE MECHANISM.** `startTimeOf(pid)` must return a value
   comparable by equality to the registry's `procStart` (observed shape: a long digit string, e.g.
   `"134322392003434636"`). **Do not assume an API or a format** — the roadmap flags this as
   deliberately unverified. Measure it against a live session before relying on it: read a real
   `~/.claude/sessions/<pid>.json`, read the same pid's start time by your chosen mechanism, and
   confirm they compare equal. **If they do not, that is a finding — record it and stop, do not
   fall back to a pid-only check**, which would reintroduce exactly the stale-file bug §4.7
   documents.
4. **Write the reader.** `readdir` the sessions directory; for each `*.json`, `readFile` and
   `JSON.parse` inside a try/catch, hand the value to `parseRegistryEntry`. A missing directory, a
   file deleted between listing and reading, a torn write, and invalid JSON are all **ordinary
   outcomes** that produce `unknown`, never an exception and never an aborted poll.
5. **Gate on protocol.** Entries with `peerProtocol !== 1` are excluded, and the service logs
   **once** per distinct unrecognised value — not once per poll, which would fill the log at the
   poll rate.
6. **Poll.** One `setInterval`, per `attention.ts:89`'s stated rule, on the order of seconds
   (**3 s** unless measurement suggests otherwise; state the number and why in a comment). Also
   refresh on pane lifecycle events so a newly launched pane does not wait a full interval.
7. **Join and record.** For each live entry, upsert `peer_sessions` (`socket_path` → `session_id`,
   `first_seen` preserved, `last_seen` updated). Join to Chorus panes via the `sessionId` main
   already receives at `index.ts:651`.
8. **Compute address state** through Task 1-1, folding with `nextStickyState` against the previous
   poll's state per session.
9. **Log disagreements (§8.2).** For a claude pane where the registry says `idle`/`busy` and
   Chorus's own heuristics say otherwise, log once per transition — **not per poll**. Include both
   values and the session id. This is the deliberate comparison §8.2 asks for: it either validates
   the heuristics or finds a bug in them, at the cost of a log line.
10. ~~**Dedupe suggestions against the machine.**~~ **MOVED TO TASK 1-3 — 2026-08-27, during
    implementation.** Both `suggestAgentName` call sites are in `LaunchDialog.vue`
    (`:94`, `:591`) — the **renderer** — and live registry names cannot reach it until the IPC
    channel exists, which is Task 1-3. Doing it here would require the very renderer edit and
    channel this task's non-goals forbid. The dedupe still ships, and is still **advisory only**
    (§6.1 forbids treating it as a reservation, because §4.7 shows a name can be taken minutes
    after launch) — it simply belongs one task later. *This was a sequencing error in the kickoff,
    not a change of intent.*

## Test Expectations

`fleetRegistry.test.ts`, with the filesystem and the probe injected:

- A directory of three well-formed files yields three entries.
- One malformed file among three does not prevent the other two from being read.
- A missing sessions directory yields an empty fleet, not a throw.
- A file whose pid is dead is excluded; a file whose pid is alive but whose `procStart` differs is
  **also** excluded (the recycled-pid case).
- `peerProtocol: 2` is excluded and logs once across repeated polls, not once per poll.
- `peer_sessions` is upserted for each live entry with a socket path; `first_seen` survives a second
  poll while `last_seen` moves.
- A status disagreement logs once per transition, not per poll.
- ⚠ **A test asserting no `name` column exists on `peer_sessions`** — the schema is the place this
  phase's prime constraint can be violated silently.

## Verification Commands

```
npm run typecheck
npx vitest run
npm run grep:secrets
node -e "const s=require('fs').readFileSync('src/main/services/storage.ts','utf8');const i=s.indexOf('const MIGRATIONS: string[] = [');console.log('MIGRATIONS entries:',[...s.slice(i).matchAll(/\/\/\s*v(\d+)/g)].map(m=>+m[1]).sort((a,b)=>a-b).pop())"
```

Expect typecheck **0**, vitest at **82+ files / 3015+ tests all passing**, `grep:secrets` **clean,
6 patterns**, and the migration probe printing **23**.

**Runtime gate (G-A) — run it.** `npm run dev -- --remote-debugging-port=9333` with at least one
claude pane. Confirm from the logs and the DB: the poll runs at its interval without throwing; a
`peer_sessions` row appears for each live claude session; killing a session's process by pid leaves
its registry file behind **and the service still drops it from the fleet** (this is §4.7 reproduced
deliberately); corrupting one `~/.claude/sessions/*.json` file to invalid JSON does not stop the
poll. **Restore anything you corrupt.** Obey G-E: the installed Chorus must be untouched and still
running afterwards.

## Acceptance Criteria

- `peer_sessions` exists after boot; `SELECT` shows one row per distinct socket path observed.
- No column anywhere stores the registry `name`.
- A leaked registry file for a dead pid never appears in the fleet.
- The unrecognised-protocol log fires once, not per poll.
- Existing behaviour is unchanged: the activity light behaves exactly as before, and the full suite
  is at or above its baseline.

## Review Checklist

- [ ] `v23` was computed by the G6 procedure across all branches **and** the DB, with the numbers in
      the commit message — not copied from this document.
- [ ] The Windows start-time mechanism was **measured against a live session**, not assumed, and the
      measurement is recorded. Liveness is not pid-only.
- [ ] Every filesystem call is inside a handler that turns failure into a value.
- [ ] `messagingSocketPath` is never opened; `.key` files are never read or even listed.
- [ ] One `setInterval` for this service, per `attention.ts:89`.
- [ ] The §8.2 comparison **logs only** — no activity-light behaviour changed.
- [ ] Dedupe is advisory; nothing treats a suggestion as a reservation.
- [ ] `peer_sessions` has no `name` column.

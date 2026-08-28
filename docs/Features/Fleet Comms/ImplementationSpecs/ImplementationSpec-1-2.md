# Implementation Spec 1-2 — the registry service, `v23`, and the probe

Companion to `Tasks/Task-1-2.md`.

---

## Migration `v23` — exact DDL

Append to the `MIGRATIONS` array in `storage.ts` (declared at `:175`), in the array's house style:
a comment block stating the reasoning, then the SQL.

```sql
CREATE TABLE IF NOT EXISTS peer_sessions (
  socket_path TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_peer_sessions_session ON peer_sessions(session_id);
```

**The comment block must carry these four points**, because each one is a question a later reader
will otherwise re-open:

1. **Why the socket path is the primary key.** It is what a cross-session message actually carries
   as its sender (`from="uds:\\.\pipe\LOCAL\cc-msg-<hash>"`, spec §4.3). The message record carries
   **no sender `sessionId`**, so this table is the only bridge from a message to a pane.
2. **Why it is persisted now rather than in Phase 2 (D1).** The hash is **not derivable** from the
   `sessionId` — md5 and sha256 variants of the id, with and without dashes and case-folded, were
   tested and none reproduce it. So the mapping cannot be reconstructed later: a sender that exits
   while nothing is recording is unresolvable **forever**, and Phase 2 renders it as non-clickable
   text. This history cannot be backfilled, which is the same argument the roadmap makes for
   Mission Control's telemetry in Phase 8.
3. **Why there is no `name` column, and why that is not an oversight.** D182 / spec §6.1: the
   registry `name` is live state, never persisted, never a key. A `name` here would be the exact
   cached promise this phase exists to prevent, and it would look harmless.
4. **Why there is no foreign key to `sessions`.** D16 resolution (d): a pane's row is deleted on
   close, and this table is history — it must survive its session's deletion, exactly as
   `dispatches` and `agent_turns` do.

⚠ **The number is computed, not copied.** The v22 entry's own comment records doing this; follow it.
Record in the commit message what `MIGRATIONS` reads on each branch and what the dev DB's
`SELECT MAX(version)` says.

Mirror the DDL in `src/main/db/schema.ts` as a `sqliteTable('peer_sessions', …)` — the schema test
compares the two and will fail on drift.

## The process probe — the part most likely to be got wrong

Task 1-1's `ProcessProbe` needs `startTimeOf(pid): string | null`, comparable **by equality** to the
registry's `procStart`. The observed value is a long digit string (e.g. `"134322392003434636"`),
which has the shape of a Windows FILETIME — 100-nanosecond ticks since 1601 — but **that inference
is not a verification and must not be shipped as one.**

Required procedure, before any code depends on it:

1. Pick a live session from `~/.claude/sessions/` and note its `pid` and `procStart`.
2. Read that pid's creation time by your chosen mechanism.
3. Compare. **Equal → proceed. Not equal → you have a finding.** Record the two values, and do not
   silently degrade to a pid-only check — that is the stale-file bug §4.7 documents, reintroduced.
4. Whatever mechanism you settle on, isolate it in **one function** with the measurement written
   into its comment, so a future platform change has one place to fix.

⚠ Note the constraint on how you measure: filtering `Win32_Process` by a **CommandLine substring
matches the query doing the filtering**. Filter by `Name` and select by `ProcessId`.

## The service shape

```ts
export interface FleetSnapshot {
  readonly entries: readonly FleetEntry[]       // live, protocol-supported
  readonly duplicates: ReadonlySet<string>
  readonly readable: boolean                    // false => the UI shows `unknown`
  readonly observedAt: number
}
```

`readable: false` is the honest representation of "the registry could not be read at all" and is
what makes `unknown` reachable in the UI. **Do not represent it as an empty fleet** — an empty
fleet means *there are no peers*, which is a different and much stronger claim.

Constructor takes its dependencies (sessions directory, probe, clock, storage) so the test can
supply fakes; nothing is reached for ambiently.

## Poll cadence

One `setInterval`, per the rule stated at `attention.ts:89`. **3 s**, unless a measurement says
otherwise — §8.1 calls for "a poll on the order of seconds", the files are small and few, and the
cost is inside the noise of what main already does. Put the number in a named constant with the
reasoning beside it, and refresh additionally on pane lifecycle events so a fresh pane is not blind
for a whole interval.

## Logging discipline

Two log sites, both **edge-triggered**, because a poll-rate log is a log nobody reads:

- **Unrecognised `peerProtocol`** — once per distinct value seen, held in a `Set`.
- **§8.2 status disagreement** — once per transition per session, holding the last-reported pair.
  Include the registry status, Chorus's computed status, and the session id. The comparison is the
  point of the exercise: it validates the heuristics behind `WORKING_STALE_MS` (45 s) and
  `OUTPUT_STALE_MS` (10 s) or finds a bug in them.

⚠ **Log nothing from a registry file except `pid`, `sessionId`, `status` and `peerProtocol`.** Do
not log `cwd` (a path), `name` (user text), or `messagingSocketPath`.

## Wiring in `index.ts`

Construct after storage is bound and after `agentEvents`, near the existing `onTranscriptPath`
registration at `:651` — that callback is where main already learns the claude `sessionId` that this
service joins on. Stop the timer on app quit alongside the other shutdown work.

## Verification beyond the build

The runtime gate in the task doc is the real verification. Three checks are worth calling out as
the ones that would otherwise be skipped:

- **The leaked-file case** — kill a claude pane's process by pid, confirm its `<pid>.json` is still
  on disk, and confirm the service drops it anyway. This reproduces §4.7 on purpose.
- **The torn-read case** — write invalid JSON into one registry file and confirm the poll survives
  and the other entries still resolve. **Restore the file afterwards.**
- **The `peer_sessions` growth case** — confirm `first_seen` does not move on a second poll while
  `last_seen` does.

Obey G-E throughout: identify the dev app by its `*9333*` command line, never by process name, and
confirm the installed Chorus is still running when you are done.

# Fleet Comms — Phase 1 Overview: peer awareness and the honest chip

**Feature:** Fleet Comms · **Roadmap:** `docs/Features/Foundation/roadmap.md` §7 Phase 9, §6 **D182**
**Spec (authoritative on design):** `../chorus-fleet-comms-spec.md` (907 lines)
**Kicked off:** 2026-08-27 · **Predecessor:** Phase 0, landed and driven as **`3aa57a4`**
**Branch:** `chorus/Chorus/e27d8654`

---

## 1. The phase contract

Chorus can already give a claude pane an address other agents reach it by (Phase 0). It cannot yet
tell you **whether that address is still true**, which peers exist, or what state they are in.

Phase 1 makes Chorus a *reader* of the fleet: it polls the session registry Claude Code maintains
on disk, joins it to Chorus panes by `sessionId`, and shows each claude pane its **current**
address with an honest state. It writes nothing to the fleet and speaks no protocol.

**The prime constraint, from D182 / spec §6.1 — it governs every task below:**

> The registry `name` is **live state**. Chorus does not persist it, key on it, index it, or treat
> it as authoritative. Chorus **never re-asserts a name**. Everything durable keys on pane identity
> and the claude `sessionId`.

A chip that renders `requestedName` is the bug this phase exists to prevent. Council FC-1.0 Q4
killed exactly that, and Phase 0 shipped deliberately UI-less so this phase could do it correctly.

---

## 2. Verified ground facts

**Every fact here was checked against the code on 2026-08-27, in this worktree, at `07708c8`.**
Nothing is carried over from the spec on trust.

| Fact | Verified value | Where |
| --- | --- | --- |
| Phase 0's launch-spec field | `readonly sessionName?: string` | `src/main/adapters/types.ts:496` |
| Phase 0's storage read (covers restore) | `sessionName: this.storage?.getSessionById(sessionId)?.name ?? undefined` | `src/main/services/sessionManager.ts:872` |
| The argv sanitiser | `toPeerAddress` | `src/shared/agentNames.ts:110` |
| Single-session getter | `getSessionById(id): SessionRow \| null` | `src/main/services/storage.ts:1777` |
| The join key Chorus already receives | `agentEvents.onTranscriptPath((sessionId, transcriptPath) => {` | `src/main/index.ts:651` |
| Heuristic staleness constants (§8.2 comparison) | `WORKING_STALE_MS = 45_000` · `OUTPUT_STALE_MS = 10_000` | `agentEventsCore.ts:317, :362` |
| `IpcChannel` entries | **111** | `src/shared/ipc.ts` |
| Next free migration | **v23** (highest `// vN` marker in `MIGRATIONS` is v22) | `storage.ts:175` |
| Single-`setInterval` precedent | `attention.ts:89` states the one-timer rule; timer at `:150` | `src/main/services/attention.ts` |
| Pane header markup | `<div class="pane-header">` … `<span class="pane-title">` | `TerminalPane.vue:1235–1239` |
| ⚠ `TerminalPane.vue` line endings | **2064 CRLF + 1 LONE CR + 2124 bare LF** — mixed | measured byte-wise |
| ⚠ `roadmap.md` line endings | **1 lone CR** inside a documented `"text\r"` literal | measured byte-wise |
| Test baseline | **82 files / 3015 tests, all passing** · typecheck **0** · `grep:secrets` **clean, 6 patterns** | run 2026-08-27 |

**Registry shape** (spec §4.1, re-observed live during the Phase 0 drive): one file per live session
at `~/.claude/sessions/<pid>.json`, carrying `pid`, `sessionId`, `cwd`, `startedAt`, `procStart`,
`version`, `peerProtocol`, `peerFeatures`, `messagingSocketPath`, `name`, `nameSource`,
`nameSince`, `status`. A sibling `<pid>.<sha256>.key` exists and **must never be read**.

---

## 3. Decisions resolved at kickoff

**D1 — the `messagingSocketPath` → `sessionId` mapping is PERSISTED NOW, in migration `v23`.**
*Resolved 2026-08-27 by Matthew.* A new `peer_sessions` table, upserted on every poll.

The alternative was an in-memory map with Phase 2 creating the store. Rejected because **this
history cannot be backfilled**: the socket hash is not derivable from the `sessionId` (md5 and
sha256 variants tested, none match — spec §4.3), so a sender that exits while nothing is recording
is unresolvable *forever*, and Phase 2's timeline renders it as non-clickable text. The roadmap
makes the identical argument for Mission Control's telemetry in Phase 8. Every day the recorder is
absent is permanently lost attribution.

**D2 — generated name suggestions are NOT prefixed with `chorus-`.** *Resolved 2026-08-27 by
Matthew.* The rail keeps short human names (`Mae`, not `chorus-Mae`), because the address and the
displayed name must be the same string (§6.1) and the prefix would put four characters of
boilerplate on every name in the UI. Collisions with sessions Chorus did not launch remain
possible and are handled where §6.1 already puts them — the `changed` state. **Dedupe against live
registry names still ships** (Task 1-2); only the prefix is declined. Grok 4.6 called the prefix
"optional hygiene, not part of the addressing rule", and that is the reading adopted.

---

## 4. Task split

Four tasks, each owning a disjoint file set.

| Task | Owns | Depends on |
| --- | --- | --- |
| **1-1** Registry reader core — pure | `fleetRegistryCore.ts` + test | None |
| **1-2** Registry service, liveness, `v23`, disagreement log | `fleetRegistry.ts`, `storage.ts`, `schema.ts`, `index.ts` wiring | 1-1 |
| **1-3** IPC + the pane address chip | `shared/ipc.ts`, `preload`, `TerminalPane.vue`, store | 1-2 |
| **1-4** Fleet roster | roster component + store | 1-3 |

**1-4 is the droppable one.** If the phase runs long, tasks 1-1 through 1-3 are a coherent, useful
shipment on their own: every claude pane shows an honest address. The roster is additive.

---

## 5. Phase-wide non-goals

Enforced by every task's own non-goals section, restated here so they cannot be lost:

- **Never open `messagingSocketPath`, read a `.key` file, or send peer-protocol bytes.** Permanent,
  not revisitable (spec §7.4). *Reading the socket path STRING out of a registry file is not
  opening it, and D1 requires it.*
- **No composer, no send box, no reply affordance** anywhere in Phases 0–3.
- **No timeline, no transcript tailing, no message index** — Phase 2.
- **No broadcast** — Phase 3.
- **No unread counts, notifications, presence pings, pulsing indicators, or ambient placement.**
  Council Q3 prohibited unread state outright; it is the mechanism that turns a consulted view into
  an activity feed.
- **Do not replace or modify the activity light.** Spec §8.2 is explicit: the existing path covers
  every adapter, the registry covers one, and a swap trades breadth for accuracy. Phase 1 *logs*
  disagreements and changes no behaviour.
- **Do not persist, key on, or index the registry `name`.**
- **Do not make codex, opencode, kimi or grok addressable.** They are in no registry. A non-claude
  pane renders *not addressable* — a fact about the agent, not a failure.
- **Do not claim the roster is complete.** The fleet is larger than Chorus in both directions.
- **Do not revert, stage, or commit `.mcp.json`**, which is modified in the tree and unrelated.

---

## 6. Gates every task inherits

**G-A — run it, do not merely compile it.** A green build proves nothing about a poll loop. Each
task states what to observe in the running app.

**G-B — the migration number is COMPUTED, not copied.** Task 1-2 claims `v23`. Before writing it,
re-run the roadmap's G6 procedure in full: parse the `MIGRATIONS` array on **every branch and
worktree**, not just this one, and confirm against the dev DB's own `SELECT MAX(version)`. The
roadmap records D148 colliding on a merge once already, and this session watched `origin/main`
claim D181 mid-flight.

**G-C — byte-wise edits for the two mixed-ending files.** `TerminalPane.vue` (Task 1-3) and
`roadmap.md` carry a lone CR. Read as a Buffer, splice, assert the CR count is unchanged. A
text-mode round-trip splits the line and produces a thousands-of-lines phantom diff.

**G-D — establish whether a failure pre-exists your change** before reporting it. Stash with a
unique tag, capture the SHA immediately, restore with `git stash apply <sha>`, and **diff what came
back**. The stash stack is shared with every worktree on this machine, and a dirty-tree merge can
leave an auto-stash un-popped and silently revert uncommitted work.

**G-E — never kill Electron or Chorus by process name.** The installed Chorus at
`%LOCALAPPDATA%\Programs\Chorus` is the user's real instance and normally runs with live agent
sessions. Identify the dev app by its command line (`*9333*`), kill only that tree, and verify the
installed one survived.

---

## 7. Phase acceptance

Every claude pane in a project shows a fleet dot matching its registry status within one poll
interval. A killed session **disappears from the roster rather than lingering on its leaked
registry file**. A non-claude pane renders *not addressable* rather than vanishing. A pane whose
address is taken by another session shows `changed` with both names **and keeps showing it** rather
than flashing once. An unreadable registry renders `unknown`, never the last good name. The
`peer_sessions` table accumulates one row per distinct socket path observed.

All of it observed in the running app, not inferred from tests.

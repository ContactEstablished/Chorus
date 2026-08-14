# Task 4-2 — The Attention Inbox

_Phase 4, task 2 of 4. **One narrated commit (G3).** The phase's headline in-app surface, and **the only one fully verifiable on this machine.** This task governs scope; `ImplementationSpecs/ImplementationSpec-4-2.md` governs exact contents._

> **⚠ THIS TASK MOVES THE `IpcChannel` COUNTER, WHICH F54 RECORDS COLLIDING FOUR TIMES ACROSS PARALLEL BRANCHES.** It is **86** at `00f0f0d`, asserted twice in `src/shared/ipc.test.ts`. Two channels are added here, so it becomes **88** — **confirm the starting figure against the MERGED tree at the moment of writing, not against this number**, and update **both** assertions. G6 applies in full.
>
> **⚠ THE ASSERTION LINE NUMBERS ALREADY MOVED ONCE — 3438/3816 → 3442/3820 (Task 4-1 added four import lines above them, `8cbd37c`). The VALUE is still 86.** This is F54's hazard in miniature and the reason the rule is *grep for the assertion, never seek to a remembered line*. Every other line number in the *Initial Starting Point* table below is likewise measured at `00f0f0d` and is now stale by the 4-1 commits — **re-measure the whole table when this task's execution prompt is generated** (e.g. `agentEvents.ts` `snapshot()` is now at **`:353`**, not `:311`).

## Source Of Truth

- `Tasks/Phase-4-Overview.md` — §3 (**what the Inbox shows and what it does not** — read this before writing a single line of template), §5 (constraints).
- `Tasks/Task-4-1.md` — the `reason` field this surface exists to display.
- `docs/design/v2/Chorus Attention Inbox.dc.html` — the mock, and **the authority under D73 for layout, wording and keys**. It is **not** the authority for the preview panel; see Non-Goals.
- Roadmap §6 **D145** (no bus), **D83** (*omit it or give it a source — never fake it*), **D73** (the mock is the authority), **D14** (plain objects across the bridge).
- `src/main/services/attentionRollup.ts` — **the precedent to follow closely.** Same shape of problem (a cross-project join the renderer structurally cannot do), same answer (a pure core in main, inputs passed in, unit-tested with no Electron host).
- `src/renderer/src/components/CommandPalette.vue` (218 lines) — the overlay precedent: scrim, `role="dialog"`, `aria-modal`, `Escape`/arrow handling at `:52`/`:56`.

## Initial Starting Point — verified at `00f0f0d`

| Location | State today |
|---|---|
| `agentEvents.ts:311` | `snapshot()` — every session with a known activity, `{sessionId, activity, since}` (+ `reason` after 4-1) |
| `storage.ts:1629` | `getAllSessionStates()` → `{id, projectId, status, exitCode}` — **no agent, no name, no title** |
| `storage.ts:1049` | `listProjects()` → `ProjectRecord[]` |
| `ipc.ts:4041` | `computeProjectAttention()` — the rail roll-up, recomputed on demand, never cached |
| `ipc.ts:4060` | `lastAttentionJson` — the push-only-when-changed equality guard |
| `App.vue:430` | `anyOverlayOpen = dialogOpen \|\| paletteOpen \|\| worktreePanelOpen` |
| `App.vue:569` | `overlayOpen: anyOverlayOpen.value` — reported to main's attention tracker |
| `App.vue:650` | `focusSession: (id) => viewStore.setFocused(id)` |
| `shared/ipc.ts` | `IpcChannel` = **86** |

**There is no Inbox, no inbox core, and no channel for one.**

## Goal

An ordered, cross-project queue of every session that currently needs a human — agent, project, reason, and how long it has been waiting — navigable with `j`/`k`, opened and closed with a key, and where `Enter` **focuses the real pane**. Oldest first, because the rail's whole job is to surface the longest-ignored thing in the app.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/attentionInboxCore.ts` | **Create.** Pure: session rows + activity records + project names → the ordered list. No `fs`, no clock, no Electron. |
| `src/main/services/attentionInboxCore.test.ts` | **Create.** |
| `src/main/services/storage.ts` | **Edit.** Widen `getAllSessionStates()` with `agent`, `name`, `title`. **No migration.** |
| `src/shared/ipc.ts` | **Edit.** Two channels + their schemas. **86 → 88.** |
| `src/shared/ipc.test.ts` | **Edit.** Both `toHaveLength` assertions → **88**; schema shape tests. |
| `src/main/ipc.ts` | **Edit.** The compute, the handler, and the push — modelled on `computeProjectAttention` at `:4041`. |
| `src/renderer/src/components/AttentionInbox.vue` | **Create.** |
| `src/renderer/src/App.vue` | **Edit.** Mount it, register its key, **and add it to `anyOverlayOpen`**. |

Nothing else. **No migration, no adapter file, no `agentEvents.ts` change, no npm dependency.**

## ⚠ What the Inbox renders — and the two things it must not

**Renders:** agent label · project name · session name/title · reason (`asking permission` / `stopped` / `notice`) · **waiting-for**, derived from `since`.

**Does NOT render, and this is a decision (Overview §3), not an omission to be helpfully corrected:**

- **No preview text.** The mock draws the agent's message, the tool call and the numbered prompt options. **Every one is a hook-body field D130 refuses to read.** A preview *could* be built from the pane's own post-scrub ring buffer with no D130 widening at all — and it is still omitted, because **F58 measured those buffers to be TUI repaint streams, not transcripts** (44,958 non-blank lines, 14 unique, 3,211× duplication). D83: omit it, or give it a source — **never fake it.**
- **No inline answering.** `Enter` focuses the pane; the user answers where the prompt actually is. Answering a prompt you cannot see is worse than not offering to.

**⚠ AN IMPLEMENTER WHO FINDS A WAY TO SHOW THE PROMPT TEXT HAS NOT FOUND A BONUS.** They have found the preview spike a later phase owes a measurement to. Record it as a finding; do not ship it.

## ⚠ Ordering, and the three ways it goes quietly wrong

1. **Oldest first, by `since`.** The same rule and the same reason as `attentionRollup.ts:93` — *"a project where someone has been blocked for 20 minutes must not have its escalation reset because a second agent stopped one second ago."*
2. **⚠ ONLY `running` SESSIONS ARE ELIGIBLE.** `attentionRollup.ts:121` reads activity **only inside the `running` branch**, and its comment says why: an exited session's amber is stale in-memory state for an agent that is already gone. **F59 makes this sharper for the Inbox than for the rail** — a session healed to `exited` shows an empty pane beside a complete mirror on disk, and listing it as *"waiting"* would send the user to a dead pane. Exited sessions are **not** Inbox items.
3. **⚠ A THREE-STATE AGENT IS NOT A CALM ONE — IT IS AN UNKNOWN ONE, AND IT MUST SIMPLY BE ABSENT.** `codex`, `kimi` and `opencode` carry `hooks: null` and never report activity. They must not appear as permanently-calm rows, must not appear with a null reason, and must not be counted in the "N waiting" tally. Absence is the honest rendering. **Assert this with a test**, because the natural `sessions.map(...)` implementation includes them by default.

## Non-Goals

- **No preview panel, no inline answer, no `session:write` call.** See above.
- **No notification centre.** That is Task 4-3. The Inbox shows what needs you **now**; the centre shows what **fired**. Two surfaces, and conflating them makes the Inbox a log.
- **No policy.** The Inbox lists everything waiting, unfiltered. Task 4-3 decides what is worth *notifying* about; that is a different question from what is worth *listing*.
- **No persistence, no table, no migration.** D145. `MIGRATIONS.length` stays **19**, `sqliteTable(` stays **18**.
- **No change to `agentEvents.ts` or `agentEventsCore.ts`.** Task 4-1 finished with them; this task is a **consumer**.
- **No change to `attentionRollup.ts`.** It derives the two states worth interrupting for; the Inbox derives a list. `attentionRollup.ts:126` explicitly declines to share the rule — *"collapsing them would force one caller to discard half the answer."* Do not collapse them now.
- **No tray, no toast, no OS surface.** Task 4-4.
- **No new dependency for the list or the keyboard handling.** The palette does both in 218 lines of plain Vue.
- **Do not revert, stage, or commit unrelated or untracked files** — see Overview §7.

## Dependencies

**Task 4-1** — the `reason` field. The Inbox is buildable without it but would render a column it cannot fill, which is the D83 failure this phase is trying not to commit.

## Test Expectations

Unit (`attentionInboxCore.test.ts`, pure, no Electron host — the `attentionRollup.test.ts` shape):

1. Oldest-first ordering across **multiple projects**.
2. A `working` session is absent.
3. An **`exited`** session with a stale `needs-you` activity record is absent (point 2 above).
4. A session with **no activity record at all** (a three-state agent) is absent (point 3).
5. Each reason maps to its stated label.
6. A session whose `projectId` names **no project** yields a row with a null/fallback project name rather than throwing — **F47 recorded exactly such rows existing in the dev database**, and a core that throws would blank the whole Inbox.
7. A session with neither `name` nor `title` still renders identifiably (fall back to the agent label plus a short id — never an empty cell).

Renderer:

8. `j`/`k` move the selection; `Enter` emits focus for the selected id; `Escape` closes.
9. The empty state renders the mock's wording (*"All voices working."* / *"nothing needs you"*).

Shared:

10. `IpcChannel` is **88**, asserted in both places; the two new schemas round-trip.

**No test count regression** against 1977 / 58.

## Verification Commands

```bash
npm run typecheck          # 0 errors, node + web
npm test                   # >= 1977 across 58+ files, exit 0
npm run grep:secrets       # clean
grep -n "toHaveLength(88)" src/shared/ipc.test.ts   # BOTH sites updated
grep -c "sqliteTable(" src/main/db/schema.ts        # still 18
```

## Acceptance Criteria

1. Typecheck 0; tests green with no regression; secret-grep clean.
2. `IpcChannel` is **88** and **both** assertions agree. The starting figure was **re-read from the merged tree**, not copied from this doc (G6/F54).
3. `MIGRATIONS.length` still **19**; `sqliteTable(` still **18**.
4. **Runtime, on the real app against a throwaway `--user-data-dir`:** two `claude` panes in **different projects** driven to a waiting state; the Inbox lists **both**, **oldest first**, with the correct project names and reasons, and the ages advance.
5. **Runtime:** `Enter` on a row **focuses that pane** — photographed or CDP-asserted, not reasoned.
6. **Runtime:** a `codex` pane running alongside is **absent** from the list and from the count.
7. **Runtime:** killing a listed session removes its row **without a manual refresh** (the push path works, not just the cold read).
8. Opening the Inbox sets `overlayOpen` — verify main's attention tracker classifies the time as `overhead` (`attentionCore.ts:177`), which is what stops Inbox-reading being billed as work on the underlying session.
9. The empty state renders when nothing is waiting.

Evidence under `_verify/4-2/`.

## Review Checklist

- [ ] `IpcChannel` re-read from the merged tree; **both** assertions updated (F54).
- [ ] No preview text, no `session:write`, no ring-buffer read anywhere in the diff.
- [ ] Exited sessions excluded — test, not comment.
- [ ] Three-state agents absent — test, not comment.
- [ ] Ordering is oldest-first and uses `since`, never a locally computed age (`shared/ipc.ts:1837`: an age goes stale in flight; an instant does not).
- [ ] `attentionRollup.ts`, `agentEvents.ts`, `agentEventsCore.ts` all byte-identical.
- [ ] The Inbox is in `anyOverlayOpen` (`App.vue:430`).
- [ ] Payloads crossing the bridge are plain objects, snapshotted (D14).
- [ ] Zod validation is in **main only** — none in preload.
- [ ] No migration; no new table; no npm dependency.

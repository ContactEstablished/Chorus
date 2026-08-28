# Implementation Spec 1-3 — the channel, the store, and the chip

Companion to `Tasks/Task-1-3.md`.

---

## The channel

One push channel, following `project:attention` (`ipc.ts:50`) rather than a new idiom. Suggested
name `fleet:snapshot`; the exact string matters less than that there is **one** of them.

```ts
// shared/ipc.ts — validated in MAIN only (D1)
export const fleetAddressStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('verified'), address: z.string() }),
  z.object({
    kind: z.literal('changed'),
    requested: z.string(),
    current: z.string(),
    cause: z.enum(['collision']).nullable()
  }),
  z.object({ kind: z.literal('unknown'), reason: z.string() })
])

export const fleetSnapshotSchema = z.object({
  readable: z.boolean(),
  observedAt: z.number(),
  /** keyed by CHORUS session id — the renderer's own identity for a pane */
  states: z.record(z.string(), fleetAddressStateSchema),
  /** peers not owned by Chorus, for Task 1-4's roster. Present here so the
   *  roster does not need a second channel; ignored by this task. */
  externalPeers: z.array(z.object({ name: z.string(), cwd: z.string(), status: z.string() }))
})
```

**`readable` is separate from an empty `states` map on purpose.** Empty means *no peers*; unreadable
means *we cannot say*. Collapsing them would make "the registry is missing" render as a confident
"you have no fleet", which is the class of lie this whole phase is built to avoid.

**Dedupe the push in main** against the last payload's JSON, exactly as `project:attention` does with
`lastAttentionJson` — a stable fleet then costs zero messages at the poll rate, and the renderer
re-renders only on change.

## D14, restated because it has no compile-time signal

Everything crossing the bridge must be a plain object. If any part of the snapshot is held in a
class instance, a `Map`, a `Set`, or anything reactive, convert first:

```ts
const payload = JSON.parse(JSON.stringify(snapshot))
```

`Map` and `Set` do not survive `JSON.stringify` at all — they become `{}`. Task 1-2's snapshot uses a
`ReadonlySet` for `duplicates`; **that field must not be sent**, and the `states` record must be a
plain object, not a `Map`. This is a silent data-loss bug, not a crash.

## The store

Hold the **whole snapshot**, expose a lookup:

```ts
function addressFor(chorusSessionId: string): FleetAddressState {
  if (!snapshot.value) return { kind: 'unknown', reason: 'no snapshot yet' }
  if (!snapshot.value.readable) return { kind: 'unknown', reason: 'registry unreadable' }
  return snapshot.value.states[chorusSessionId] ?? { kind: 'unknown', reason: 'not in fleet' }
}
```

⚠ **There is deliberately no per-session cached address anywhere in the renderer.** The single most
likely way to reintroduce the bug this phase exists to fix is a well-meaning
`lastKnownAddress` that survives a bad poll "so the UI doesn't flicker". The flicker *is* the
information. §6.1: the live name is the only string shown as routable.

## The chip

Insert into `pane-header-row` (`TerminalPane.vue:1236`), after `pane-title` (`:1238`).

| State | Rendered | Notes |
| --- | --- | --- |
| `verified` | `Mae` | plain, no decoration — the good case should be quiet |
| `changed` | `Requested Mae · now redesign-dictation-overlay` | current is the dominant half; append ` · collision` only when `cause === 'collision'` |
| `unknown` | `Address unknown` | never the last good name |
| non-claude | `Not addressable` | a fact about the agent |

Styling notes: `.pane-header` styles start at `:1626` and `:1723`; follow the existing token usage.
`ProjectRail.vue:24` records that file as containing no raw hex — **the same discipline applies
here**: use 3c-1 tokens, no literal colours.

**`changed` must be visually distinguishable but must not shout.** It is not an error — a renamed
agent is working fine, it is merely reachable under a different name. Reserve error affordances for
errors.

## Why the chip is here at all, given Phase 0 shipped without one

Worth a comment in the component, because it looks like an oversight otherwise: Phase 0 threaded
`-n` and deliberately rendered **nothing**, because a chip drawn from the requested name is a cached
promise (spec §7.1, council Q4). The chip only became honest once a live registry read existed —
which is Task 1-2. **A future change that renders this chip from `sessions.name` instead of the
snapshot would silently undo the entire phase**, and would look like a simplification.

## Byte-wise editing (G-C), concretely

```js
const fs = require('node:fs')
const P = 'src/renderer/src/components/TerminalPane.vue'
const before = fs.readFileSync(P)
const count = (b) => { let crlf=0, lone=0, lf=0
  for (let i=0;i<b.length;i++){ if(b[i]===13){ b[i+1]===10?crlf++:lone++ } else if(b[i]===10) lf++ }
  return {crlf, lone, lf} }
const b0 = count(before)
// ... Buffer.indexOf the anchor, Buffer.concat the insert ...
const b1 = count(after)
if (b1.lone !== b0.lone) throw new Error('lone CR count changed — abort')
```

Then confirm with `git diff --stat`. A four-figure line count on this file means the round-trip
rewrote every line ending; revert and redo.

## Verification

Both counter probes in the task doc, plus the runtime gate. The runtime check that matters most and
is easiest to skip: **make the registry unreadable while the app is running** (rename the sessions
directory briefly) and watch the chips go to `Address unknown` rather than holding their last good
value. Restore the directory afterwards, and confirm the chips recover on the next poll.

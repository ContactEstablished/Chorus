# Implementation Spec 1-1 — `fleetRegistryCore.ts`

Companion to `Tasks/Task-1-1.md`. This goes deeper: exact shapes, exact placement, and the
rationale that must survive into the code as comments.

---

## Placement rationale

`src/main/services/fleetRegistryCore.ts`, beside `agentEventsCore.ts` and `codeIndexCore.ts`.

The repo's convention is a pure `*Core.ts` holding everything decidable, with a sibling service
owning I/O. It is load-bearing here rather than stylistic: **the whole of this phase's correctness
is decision logic** — is this entry live, is this address still true, is this a collision — and a
poll loop is close to untestable while a fold over supplied facts is trivially testable. Task 1-2's
service becomes a thin shell that gathers facts and calls into this file.

## Shapes

```ts
/** A registry entry after validation. Unknown keys are DISCARDED, not carried:
 *  the CLI adds fields (peerFeatures arrived after peerProtocol) and a
 *  passthrough object invites a consumer to reach for one we never validated. */
export interface FleetEntry {
  readonly pid: number
  readonly sessionId: string
  readonly cwd: string
  readonly procStart: string
  readonly peerProtocol: number
  /** ⚠ LIVE STATE. Never persist, key on, or index this (D182 / spec §6.1). */
  readonly name: string
  readonly status: 'idle' | 'busy' | 'shell'
  readonly messagingSocketPath?: string
  readonly nameSource?: string
  readonly nameSince?: number
  readonly startedAt?: number
  readonly version?: string
  readonly entrypoint?: string
}

export type ParseResult =
  | { readonly ok: true; readonly entry: FleetEntry }
  | { readonly ok: false; readonly reason: string }

/** Process facts the CALLER gathered. Passed in so this module stays pure and
 *  so the Windows start-time mechanism can be verified and changed in one
 *  place (Task 1-2) without touching any decision logic. */
export interface ProcessProbe {
  readonly alive: (pid: number) => boolean
  readonly startTimeOf: (pid: number) => string | null
}

export type AddressState =
  | { readonly kind: 'verified'; readonly address: string }
  | {
      readonly kind: 'changed'
      readonly requested: string
      readonly current: string
      readonly cause: 'collision' | null
    }
  | { readonly kind: 'unknown'; readonly reason: string }
```

### Why exactly three, written into the file

The council specified six (`verified`, `renamed`, `collided`, `duplicate`, `unconfirmed`,
`unavailable`). The comment above `AddressState` must record why this is three, because the next
reader will otherwise "restore" the missing ones:

- `unconfirmed` and `unavailable` are **one sentence to an operator** — *we cannot vouch for this
  address*. Two spellings of that produce two code paths and one meaning.
- `collided` and `renamed` are usually **indistinguishable in the data**. A measured collision wrote
  `nameSource: "derived"`, identical to a session that never asked for a name (spec §4.8). A state
  whose evidence is usually absent is a state that is usually wrong.
- Cause is therefore an **enrichment on `changed`**, present only when `duplicateNames` proves
  another live entry holds the requested name — the one case Chorus can actually demonstrate.

## The parse

Zod, main-only (D1). Use `.passthrough()`-free strict picking: validate the known keys, build a
`FleetEntry` from them, discard the rest.

```ts
export function parseRegistryEntry(raw: unknown): ParseResult
```

**It must never throw.** Wrap `JSON.parse` at the call site in Task 1-2 and hand this a value; here,
a `safeParse` failure becomes `{ ok: false, reason }`. Spec §8.1 requires tolerant reads, and the
failure modes are real: a torn write (the CLI writes these files while we read them), a file
deleted between `readdir` and `readFile`, and an empty file.

## Liveness

```ts
export function isLive(entry: FleetEntry, probe: ProcessProbe): boolean {
  if (!probe.alive(entry.pid)) return false
  const started = probe.startTimeOf(entry.pid)
  return started !== null && started === entry.procStart
}
```

⚠ **Both halves are required and the comment must say why.** §4.7 measured a force-killed session
leaving its `<pid>.json` and `.key` behind, so file presence proves nothing. And a pid is recycled
by the OS, so a pid that exists is not necessarily *this* session — `procStart` is presumably in the
file for exactly this reason. **Task 1-2 owns verifying the Windows mechanism that produces
`startTimeOf`; this module must not assume its format**, only that it is comparable by equality to
`procStart`.

## Address state

```ts
export function addressStateFor(input: {
  readonly requestedName: string | null
  readonly entry: FleetEntry | null       // the LIVE entry joined by sessionId, or null
  readonly duplicates: ReadonlySet<string> // normalised names held by >1 live entry
}): AddressState
```

Order of decision, and it matters:

1. `entry === null` → `unknown` ("no live registry entry for this session").
2. `requestedName === null` → `verified` with the registry's own name. A pane Chorus never named is
   not *drifting*; it simply has whatever address the CLI derived, and that is honest.
3. Normalised equality of `requestedName` and `entry.name` → `verified`.
4. Otherwise `changed`, with `cause: 'collision'` **only if** `duplicates.has(normalise(requestedName))`.

Normalisation is trim + case-fold, matching `suggestAgentName`'s existing treatment of taken names
(`agentNames.ts:75`), so "  bob " and "Bob" are one address everywhere in the app.

## Stickiness

```ts
export function nextStickyState(
  previous: AddressState | null,
  incoming: AddressState,
  acknowledged: boolean
): AddressState
```

Rules, in the comment as well as the code:

- A `changed` that arrives **stays** through subsequent `verified` polls until `acknowledged`.
- An `unknown` never *upgrades* a remembered `changed` into `verified` — losing the registry is not
  evidence the name came back.
- `acknowledged: true` collapses to whatever `incoming` says.

⚠ **Do not implement this with a timestamp or a TTL.** §4.8 measured the `agent-name` record
repeating 29 times through one session; a time-based badge would flicker with it. Grok 4.6 and
DeepSeek independently made this the condition of their votes: *"a badge that evaporates treats
[collision and a wanted AI title] both as flicker"*, and *"last-write-wins rendering without a
sticky addressState will look like a silent rename to anyone who blinked."*

## Verification

Beyond the task's commands, confirm by reading:

- `grep -c "export " src/main/services/fleetRegistryCore.ts` — every export appears in the task's
  test file.
- The purity grep in the task's acceptance criteria returns nothing.
- **Runtime check is deliberately absent for this task** and that is correct: there is nothing to
  run. The first runtime gate is Task 1-2, which is where these functions first meet a real
  `~/.claude/sessions/` directory. Do not claim a runtime verification here.

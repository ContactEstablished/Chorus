# Implementation Spec 10.1-4 — the usage panel

Companion to `Tasks/Task-10.1-4.md` — placement with verified line numbers, the store and view module
as real TypeScript, the absent-state rules, and what only a run can check.

---

## Placement, and why it is not the pane chrome

**`src/renderer/src/views/ProjectSettingsView.vue`, a new `<section class="ps-section">` at line 1320**
— after the memory-schema `</section>` at `:1319`, before the destructive-door comment at `:1321-1323`
and `ps-section-lifecycle` at `:1324`. Verified at `3e391a0`: 2002 lines, 2002 CRLF terminators, **0
lone CR**, safe to edit.

The section holds a `ps-label` reading **Token ledger**, a `ps-hint` reading *"What this project's
agents actually spent, measured from their own transcripts. Four numbers, because one number is how
this gets misreported."*, and then `<EngineUsagePanel :project-id="props.projectId" />`. Section chrome
stays in the view (`.ps-section` `:1548` and its `max-width: 560px`, `.ps-label` `:1554`, `.ps-hint`
`:1561`); the panel owns `eu-`-prefixed scoped styles, as `SettingsView.vue:112-114` mounts children
that style themselves.

**Argued from where session-level information already lives:**

1. **The ring and the filmstrip card are glance surfaces for one live scalar.** `ContextRing.vue:28-30`
   sizes itself 14px on a card, 15px in the pane header, "small enough not to compete with the state
   marker". Four numbers, two ratios, a split and a per-agent source column are not a glance, and
   compressing them into one to fit that slot **recreates the single-number lie this phase exists to
   kill**. The ledger is also a retrospective (spec §5 normalises **per completed task**); the ring is
   live state, dropped on exit by both halves (`session.ts:127` is the renderer's).
2. **The data is already project-scoped** (`dispatches.project_id`, `schema.ts:294`) and **the
   navigation already exists**: `App.vue:378` declares
   `'workspace' | 'settings' | 'project-settings' | 'council' | 'day-summary'`, and `:1022` mounts this
   view from the rail's gear. No fifth view, no new window, no new concept.
3. **The neighbours are read-only measurement sections with this exact posture.**
   `ProjectSettingsView.vue:1067` gates its memory-schema block on `v-if="memoryStatus?.configured"` —
   nothing honest to say about a database nobody named, which is the gate shape a no-source agent
   needs. Fleet Comms' `ImplementationSpec-1-4` fixed the rest: **consulted, never pushed**, or this
   becomes an ambient cost dashboard.

**Rejected, recorded so it is not re-litigated:**

- **The pane header meta row** (`TerminalPane.vue:1629-1631`, fed by `contextUsage` at `:177`) — fails
  on (1). ⚠ Secondary and explicitly **not** the reason: that file is already `M` and carries **1 lone
  CR and 60 lone LF among 2297 CRLF lines** (measured byte-wise this session), so `Edit` rewrites it
  into a phantom multi-thousand-line diff.
- **The day report** (`App.vue:1031`) — `DayReportView.vue:11-17` states that screen is *deliberately
  agent-blind*, sourced from git because a commit reads identically whichever agent produced it. Token
  counts are agent-specific and transcript-sourced; putting them there breaks a property it documents.
- **A new view or window** — invented navigation, and a window implies management this feature lacks.

⚠ **The honest objection:** Project Settings is where you *change* things, so a measurement among
editable fields invites "is this a setting?". Mitigations: no control but `Refresh`, a `ps-hint` saying
what it is, and placement with the read-only sections above Lifecycle, not among the form fields at
`:793`–`:906`.

## What 10.1-3 must carry

The channel is 10.1-3's. If its payload differs **this task changes to match**; no renderer arithmetic.

```ts
/** One metric. NULL IS UNKNOWN. 0 IS A MEASURED ZERO. */
export interface LedgerMetric {
  readonly total: number | null
  readonly main: number | null   // main transcript only; null when total is null
  /** D-b, `<transcript-dir>/subagents/*.jsonl`. ⚠ NULL = the subagent files were not read.
   *  ⚠ 0 = they WERE read and there was no subagent work. Two different claims. */
  readonly subagent: number | null
}

export interface LedgerRow {
  readonly sessionId: string
  /** ⚠ A PLAIN STRING, NEVER `AgentKind`. `voiceRefine.ts:193` writes `agent: 'voice'` into
   *  `dispatches`; `agentKindSchema` (`shared/ipc.ts:974`) has no `voice`; the installed DB holds
   *  26 such rows. Typing this `AgentKind` is an F25-shaped defect — one row takes the whole
   *  aggregate down on the outbound parse. */
  readonly agent: string
  readonly title: string | null; readonly startedAt: string
  /** Decided in MAIN: does a transcript reader exist for this agent at all? */
  readonly hasSource: boolean
  readonly ce: LedgerMetric; readonly rlit: LedgerMetric
  readonly naive: LedgerMetric; readonly output: LedgerMetric
}

export interface LedgerSnapshot {
  readonly projectId: string
  readonly rows: readonly LedgerRow[]
  readonly dispatchesWithTokens: number; readonly dispatchesTotal: number  // 65 of 467 today
}
```

⚠ **No `ceTotal`, no `costUsd`, no price anywhere.** D-c: `model_catalog` (`schema.ts:460`) names
provider, model, display name, context length and freshness — **and there is no price column anywhere in
the schema**. A ratio invented to blend output into cost puts an unsourced constant inside the one
number the phase exists to trust.

## The store

`src/renderer/src/stores/engineLedger.ts`, options API, modelled on `stores/memory.ts`.

```ts
interface EngineLedgerState {
  /** ⚠ ABSENT ≠ EMPTY: absent renders "not loaded", an empty `rows` renders "no
   *  dispatches yet" — the distinction `session.ts:64-69` draws for `context`. */
  snapshotByProject: Record<string, LedgerSnapshot>
  /** Per-project supersede tokens, NOT one global counter (`memory.ts:313-325`):
   *  an unguarded `loading = false` lets a stale load clear a live one's spinner. */
  seqByProject: Record<string, number>
  loadingByProject: Record<string, boolean>; error: string | null
}
```

`load(projectId)` copies `memory.ts:313-325` exactly — bump `seq`, set `loading`, await
`window.chorus.getEngineLedger(projectId)`, `if (seq !== this.seqByProject[projectId]) return` in the
success path, the `catch` **and** the `finally`. ⚠ **A failed load leaves the last good snapshot in
place**: clearing it turns a failed refresh into the claim "this project has no usage". Session-lifetime
and re-read on mount, for `memory.ts`'s reason — the transcripts move while Chorus is closed.

⚠ **D14, stated where it would actually bite.** The only outbound payload is a string id, and a
primitive cannot be a Vue Proxy — a ceremonial `JSON.parse(JSON.stringify(...))` on it is cargo cult.
**If 10.1-3's read ever takes an options object it must be a literal built inside this action, never a
`ref` or store slice**: a proxy fails structured clone at runtime with no compile-time signal, which is
why `stores/layout.ts:111-116` snapshots the layout tree.

## The view module — where every claim is decided

`src/shared/engineUsageView.ts`. D186 and Fleet Comms Task 1-4: **this repo has no `.vue` tests**, so a
rule written in a component is a rule nothing can check. `sessionMemoryLine`
(`shared/provenance.ts:196`) returns `null` so that `FilmstripRenderer.vue:285-291` decides emptiness in
a tested core rather than in a `v-if`.

```ts
export type UsageCell =
  | { readonly kind: 'measured'; readonly value: number; readonly text: string
      readonly mainPct: number; readonly subPct: number; readonly splitKnown: boolean }
  /** ⚠ NO GEOMETRY FIELD AT ALL — not `pct: 0`; a zero that does not exist cannot be drawn. */
  | { readonly kind: 'unknown'; readonly text: '—'; readonly title: string }

export type UsageRowView =
  | { readonly kind: 'rows'; readonly sessionId: string; readonly label: string
      readonly ce: UsageCell; readonly rlit: UsageCell; readonly naive: UsageCell
      readonly output: UsageCell; readonly gap: string | null; readonly split: string | null }
  /** ⚠ A THIRD STATE, NOT A ROW OF DASHES. */
  | { readonly kind: 'no-source'; readonly sessionId: string; readonly label: string
      readonly note: 'No token source for this agent.' }

export function buildUsageView(s: LedgerSnapshot):
  { readonly rows: readonly UsageRowView[]; readonly coverage: string }   // "65 of 467 …"
```

Classification order matters: `hasSource === false` → `no-source`, decided **before** any token field is
read, so a NULL on a sourceless agent is never mistaken for a missing measurement; then `total === null`
→ `unknown`; then `measured`, **including `total === 0`**.

## The three renderings

| state | numeral | bar | row | title attr |
|---|---|---|---|---|
| `measured` | `9,197,338` | drawn | normal | full counts |
| `unknown` | `—`, `--color-text-eyebrow` | **element absent from the DOM** | dimmed | "No token data recorded for this dispatch." |
| `no-source` | none | none | one sentence | — |

⚠ **`unknown` and `no-source` must not share a label**, for `ImplementationSpec-1-4`'s reason verbatim:
one is probably temporary, the other permanent. A `—` says *we looked and found nothing*; for
`opencode`, `kimi`, `grok`, `shell` and `voice` nobody looked and nobody will until a reader exists.
**402 of 467 dispatches in the installed DB carry no token data**, and on the two agents that do have a
reader 258 of 286 claude rows and 129 of 136 codex rows have NULL `tokens_in` — drawn as zero, the panel
would claim those sessions were free. ⚠ **Do not derive one figure from the other:** the per-agent
NULL-`tokens_in` counts sum to **403**, one more than the 402, because a row can have NULL `tokens_in`
beside a non-NULL sibling column. Render the count main sends, never a sum of the rows.

⚠ **"Absent" means no element, not `width: 0`.** A zero-width `<div>` with a border, a track or a
`min-width` is a visible zero bar — the forbidden rendering arriving by CSS instead of by logic. Assert
its absence in the DOM at the runtime gate, not its width.

## Drawing, without a dependency

Horizontal bars as plain `<div>`s with `style="--w: 62%"`, not SVG: `ContextRing.vue` uses inline SVG
only because a donut needs arc arithmetic (`:35-49`). A bar needs none of it. **No charting library.**

- **Linear, normalised to the group's largest value.** `RLIT` beside `Naive` renders as a sliver and
  **that sliver is the finding**. ⚠ **No log scale** — a log axis compresses the measured `Naive/RLIT`
  of **12.46x–18.71x** into a modest difference: readable by deleting its content.
- **Colour is not the encoding** (`ContextRing.vue:18-24` restated): length carries the quantity and
  `Naive` is not painted as an alarm; one accent separates the **subagent** segment and nothing else is
  coloured. `tabular-nums` as at `:129`.
- **The split is a headline:** subagent work was **53.2%–64.9% of CE** and **74.8%–90.5% of RLIT** on
  the three measured sessions. ⚠ When `subagent === null` the bar is **one undifferentiated segment**
  and the line reads "subagent split unknown" — never a full-width main segment, which would claim the
  subagents cost nothing.

## Verification

Unit coverage is in the task doc; two things only a run answers. Seed a throwaway user-data-dir from
`%APPDATA%\chorus-app` **with `Local State`** (without it every credential blob is undecryptable, and
`npm run dev` alone has none); launch with `REMOTE_DEBUGGING_PORT=9222`; drive CDP on 9222.

- **The unknown case.** Open Project Settings for a project whose dispatches have NULL `tokens_in` and
  assert over the DOM: the cell's text is `—`, and `querySelectorAll('.eu-bar')` in that row returns
  **0** — not a zero-width one.
- **The no-source case.** A project with an `opencode` pane reads *No token source for this agent* —
  no dashes, no empty chart.

⚠ **Two CDP traps that have cost time here:** assigning `.value` to a `v-model` input leaves the model
empty unless an `input` event is dispatched, and the bug then looks like the app's rather than the
harness's; and the dev instance must be killed by matching **both** `Name=electron.exe` **and**
`*remote-debugging-port=9222*` — the bare `*9222*` also kills Chrome renderers and the querying shell.
Confirm the installed Chorus is still running afterwards.

**Deliberately not verified here: the numbers.** Whether `CE` is right is 10.1-1/10.1-2's gate against
fixtures; this panel owes only never inventing one it did not get. Claim no ledger verification here.

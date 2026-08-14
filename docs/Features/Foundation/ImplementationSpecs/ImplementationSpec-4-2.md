# Implementation Spec 4-2 — The Attention Inbox

_Governs exact contents. `Tasks/Task-4-2.md` governs scope. Measured against `main` at `00f0f0d`; **re-read every line number before editing.**_

---

## 1. `src/main/services/attentionInboxCore.ts` — new, pure

Model the file header on `attentionRollup.ts:3–26`: state what the function is, why it is pure, and what each input knows that the others do not.

### 1.1 Shape

```ts
export interface InboxSession {
  id: string
  projectId: string
  status: string
  agent: string
  name: string | null
  title: string | null
}

export interface InboxInputs {
  sessions: readonly InboxSession[]
  /** In-memory activity, or null when this session never reported one.
   *  ⚠ NULL IS THE COMMON CASE, NOT THE EDGE — three of the four adapters
   *  carry `hooks: null` and never report at all. */
  activityFor: (sessionId: string) => {
    activity: string
    since: number
    reason: 'permission' | 'stopped' | 'notice' | null
  } | null
  /** projectId -> display name. A MAP RATHER THAN A LOOKUP FUNCTION so the
   *  core cannot reach into storage; the caller does the read. */
  projectNames: ReadonlyMap<string, string>
}

export interface InboxItem {
  sessionId: string
  projectId: string
  projectName: string | null
  agent: string
  label: string
  reason: 'permission' | 'stopped' | 'notice'
  since: number
}

export function buildInbox(inputs: InboxInputs): InboxItem[]
```

### 1.2 The three exclusions, in one guard each

```ts
for (const session of inputs.sessions) {
  // (1) ⚠ ONLY `running`. attentionRollup.ts:121 nests the same way for the
  // same reason: an exited session's amber is stale in-memory state for an
  // agent that is already gone. F59 sharpens it here — a session healed to
  // `exited` shows an empty pane beside a complete mirror on disk, so listing
  // it as "waiting" sends the user to a pane that cannot answer.
  if (session.status !== 'running') continue

  // (2) No activity record at all = a three-state agent (hooks: null) or one
  // that has not reported yet. ABSENT, never "calm": the Inbox's silence about
  // a codex pane is honest, and a row saying "unknown" is not.
  const record = inputs.activityFor(session.id)
  if (!record) continue

  // (3) Working agents are not Inbox items.
  if (record.activity !== 'needs-you') continue

  // ⚠ A `needs-you` WITH NO REASON IS A BUG UPSTREAM, NOT A ROW TO INVENT ONE
  // FOR. Task 4-1 makes `reason` non-null for every `needs-you`; if one arrives
  // null the honest rendering is to skip it rather than to guess 'stopped'.
  if (!record.reason) continue
  ...
}
```

Then sort **ascending by `since`** — oldest first. Ties broken by `sessionId` so the order is **total and stable**: an unstable sort makes a list that reshuffles under the user's `j`/`k` cursor, which is worse than a wrong order because it moves the target mid-keystroke.

### 1.3 The label, and why it has a fallback

```ts
// F47 recorded session rows in the dev database whose `project_id` names no
// project — with an ENFORCED foreign key that should have made it impossible.
// A core that indexes blindly would throw there and blank the whole Inbox for
// one bad row, so the miss is a null the renderer can render.
const projectName = inputs.projectNames.get(session.projectId) ?? null

// Never an empty cell: an unnamed row the user cannot identify is a row they
// cannot act on.
const label = session.name ?? session.title ?? `${session.agent} · ${session.id.slice(0, 8)}`
```

---

## 2. `src/main/services/storage.ts` — widen one accessor

`getAllSessionStates()` (`:1629`) gains three columns:

```ts
  getAllSessionStates(): {
    id: string
    projectId: string
    status: string
    exitCode: number | null
    agent: string
    name: string | null
    title: string | null
  }[] {
    return this.d
      .select({
        id: sessions.id,
        projectId: sessions.projectId,
        status: sessions.status,
        exitCode: sessions.exitCode,
        agent: sessions.agent,
        name: sessions.name,
        title: sessions.title
      })
      .from(sessions)
      .all()
  }
```

> **⚠ WIDENING THE SHARED ACCESSOR RATHER THAN ADDING A SECOND ONE, AND `attentionRollup.ts` NEEDS NO EDIT FOR IT.** `RollupSession` (`attentionRollup.ts:30`) declares exactly four fields and is **structurally typed**, so a row carrying three more is assignable and the rail is untouched. Two near-identical full-table queries would be the worse outcome — and the docblock above the accessor already frames it as "the summary shape", which this still is. **Verify by typecheck, and do not edit `attentionRollup.ts` to acknowledge the new fields.**

**No migration.** Every column read here already exists (`schema.ts:68` — `agent` at `:73`, `title` at `:79`, `name` at `:86`).

---

## 3. `src/shared/ipc.ts` — two channels, 86 → 88

> **⚠ RE-READ THE COUNTER FIRST.** `grep -n "toHaveLength(" src/shared/ipc.test.ts`. If it is not 86, **stop** — a sibling branch has claimed channels and F54's fourth collision is in progress. Reconcile before adding.

Channel entries, placed immediately after `ProjectAttentionList` (`:54`) so the attention family stays contiguous:

```ts
  /** invoke: every session currently needing a human, across ALL projects,
   *  oldest first. PURE READ of main memory + one indexed table read. */
  InboxList: 'inbox:list',
  /** event (main -> renderer): the queue changed. Carries the COMPLETE list,
   *  so a session that stopped waiting is expressed by dropping out — the
   *  `project:attention` idiom, and for the same reason. */
  InboxChanged: 'inbox:changed',
```

Schemas, beside the activity schemas (after `:1878`):

```ts
export const inboxItemSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().nullable(),
  agent: agentKindSchema,
  label: z.string().min(1),
  reason: needsYouReasonSchema,
  since: stateSinceSchema
})
export type InboxItem = z.infer<typeof inboxItemSchema>

export const inboxListSchema = z.object({ items: z.array(inboxItemSchema) })
export type InboxList = z.infer<typeof inboxListSchema>
```

`reason` is **non-nullable here** — §1.2's last guard drops reasonless rows in main, so a null reaching the wire is a real defect and should throw at the `parse()` rather than render as a blank cell.

**Use the existing `agentKindSchema`** rather than `z.string()`: it is what makes a new agent kind a compile/parse error instead of a row labelled "Agent" (the `notifications.ts:11` precedent, where `Record<AgentKind, string>` has caught two additions).

Update **both** `toHaveLength(86)` → `toHaveLength(88)` in `ipc.test.ts` (**3438**, **3816**).

---

## 4. `src/main/ipc.ts` — compute, read, push

**Model it on `computeProjectAttention` (`:4041`) and reuse its push discipline verbatim.** Place the new code beside it.

```ts
  function computeInbox(): InboxList {
    return inboxListSchema.parse({
      items: buildInbox({
        sessions: storage.getAllSessionStates(),
        activityFor: (id) => agentEvents.recordFor(id),
        projectNames: new Map(storage.listProjects().map((p) => [p.id, p.name]))
      })
    })
  }
```

**The push.** Copy the three properties the rail's push already has, because each was earned:

1. **Push the whole list**, so a session that stops waiting drops out rather than needing a second "cleared" message.
2. **An equality guard** (`lastInboxJson`) — a burst of exits during a project close would otherwise send N identical lists.
3. **⚠ DEFER THE RECOMPUTE ONE TURN OF THE EVENT LOOP on the exit path.** `ipc.ts:4066`'s comment is load-bearing and was **found by running the app, not by reading it**: `SessionManager`'s exit fan-out is a `Set` whose order its own source says is *"not contractual"*, and the listener that persists `status='exited'` is registered **after** `registerIpc` — so a synchronous recompute reads a table that has not caught up, produces a list that still contains the dead session, matches nothing useful, and the correction never arrives. **The Inbox has the identical hazard and must take the identical `queueMicrotask`/`setImmediate` deferral. Do not re-derive this; copy it and cite it.**

**Trigger the push from the same three places the rail's is triggered from** — read `ipc.ts` around `:3966`, `:4000` and `:4011` and follow what is there rather than inventing a fourth wiring point.

Handler:

```ts
  ipcMain.handle(IpcChannel.InboxList, (): InboxList => computeInbox())
```

**Preload:** expose the invoke and the event subscription following the existing `project:attention` pair exactly. **⚠ NO ZOD IN PRELOAD** — it throws `EvalError` under CSP and silently drops events. Validation is in main, already done above.

---

## 5. `src/renderer/src/components/AttentionInbox.vue` — new

**Follow `CommandPalette.vue` (218 lines).** Scrim + `role="dialog"` + `aria-modal="true"` (`:90`, `:94`), `Escape` at `:52`, arrow handling at `:56`.

### 5.1 Content, from the mock

Header: **"Needs you"**, and the sub-line **"N waiting · oldest first"**.
Footer hints: **"j/k navigate · enter focus session · esc back to workspace"**.
Empty state: **"All voices working."** over **"nothing needs you"** — the mock's wording verbatim (D73).

Row: reason phrase · agent label · project name · **"waiting Xm Ys"**.

Reason phrasing — one map, in the component, no cleverness:

| `reason` | phrase |
|---|---|
| `permission` | `is asking permission` |
| `stopped` | `finished and is waiting` |
| `notice` | `has something to tell you` |

### 5.2 ⚠ The age must tick, and it must tick off ONE clock

`since` is an absolute instant (`shared/ipc.ts:1837`: *"an age goes stale in flight, it goes stale again while the renderer holds it"*). Render `now - since` against **one** `ref` updated by **one** interval for the whole list — not one timer per row. Stop the interval when the Inbox closes; a background timer redrawing a hidden list is exactly the kind of cost that never shows up in a screenshot.

### 5.3 Keys

`j`/`ArrowDown`, `k`/`ArrowUp`, `Enter` → emit `focus` with the selected `sessionId`, `Escape` → close. Clamp the selection when the list shrinks under the cursor — **a push can remove the selected row while the user is on it**, and an unclamped index renders blank and swallows the next `Enter`.

---

## 6. `src/renderer/src/App.vue`

Three edits, and **the third is the one that gets forgotten**:

1. Mount `<AttentionInbox>` beside the palette, bound to an `inboxOpen` ref.
2. Wire `@focus="(id) => viewStore.setFocused(id)"` — the same call `App.vue:650` already exposes as `focusSession`.
3. **⚠ ADD `inboxOpen` TO `anyOverlayOpen` (`:430`).** It currently reads `dialogOpen || paletteOpen || worktreePanelOpen`. That computed feeds `overlayOpen` on the attention report (`:569`), and `attentionCore.ts:177` returns `'overhead'` when it is true. **Miss this and every second spent reading the Inbox is billed as active work on whichever session held DOM focus** — telemetry that is confidently wrong, which F51/F52's neighbourhood says is worse than missing.

**The open key:** follow the Ctrl+K precedent's reasoning at `App.vue:435` — a focused xterm consumes keys before they bubble, so the listener rides the **capture** phase and `preventDefault` **steals** the combination from the terminal. Pick a combination that is not already meaningful inside claude or codex; note in the commit which you chose and why.

---

## 7. Verification

### Build gates

```bash
npm run typecheck        # 0, node + web
npm test                 # no regression
npm run grep:secrets     # clean
grep -n "toHaveLength(88)" src/shared/ipc.test.ts   # BOTH 3438 and 3816
grep -c "sqliteTable(" src/main/db/schema.ts        # 18
```

### Runtime — on the real app, throwaway `--user-data-dir`, never `%APPDATA%\chorus-app`

1. Two `claude` panes in **two different projects**, both driven to waiting (one to a permission prompt, one to a completed turn). Open the Inbox: **both listed, oldest first, correct project names, correct reason phrases, ages advancing.**
2. A `codex` pane running alongside: **absent from the list and from the "N waiting" count.**
3. Answer one pane. Its row **disappears without a manual refresh** — this proves the push, which the cold read alone does not.
4. **Kill** a listed session. Its row disappears, and — the §4.3 hazard — **verify the list is correct on the FIRST push, not after a second event corrects it.** Watch the actual payloads, not the screen.
5. `Enter` on a row focuses that pane. CDP-assert `document.activeElement`'s owning session, or photograph it.
6. `Escape` closes; `overlayOpen` goes false. Confirm main's tracker moved to `overhead` while it was open and back afterwards.
7. Quit every session. The empty state renders with the mock's wording.
8. **The F59 case, driven deliberately:** heal a session to `exited` while an activity record is still in memory for it. It must be **absent** — this is the scenario that would otherwise send the user to a dead pane.

Evidence under `_verify/4-2/`.

### The negative control

Temporarily drop §1.2's `status !== 'running'` guard and confirm exited sessions **do** appear. Then restore it. Three of the four exclusions are one-line `continue`s that a passing test suite would not miss if they were subtly wrong; drive at least one of them in both directions.

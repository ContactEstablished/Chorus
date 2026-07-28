# ImplementationSpec 3e-3 — Council Time Becomes Task Work (D95)

**Normative for:** [`../Tasks/Task-3e-3.md`](../Tasks/Task-3e-3.md).

## 1. `AttentionInputs` gains one field

`attentionCore.ts:56–80`'s own comment: *"Deliberately a flat bag of primitives: it is also the
exact set of facts the runtime proof has to be able to force, and anything not here cannot
influence the number."* **That contract is why the new fact must be added HERE and not read from
somewhere else inside `classify()`** — a classifier that reaches outside this bag becomes
untestable and unforceable.

Add **one nullable field**: the project id the council view is currently bound to, `null` whenever
the renderer is not in the council view **or is in it with no project selected**. Keep it a
primitive; keep the bag flat.

**⚠ Do not reuse `activeSessionId`.** Its comment already warns it is not `focusedSessionId`; a
council run has no session, and overloading the field would make `pane` and council attribution
indistinguishable downstream.

## 2. The branch in `classify()`

`attentionCore.ts:89` — *"FIRST MATCH WINS, AND THE ORDER IS THE SPECIFICATION"*. **Insert
deliberately, and state the position in the report.**

The rule, precisely:

> A view with no pane mounted is `overhead` **unless it is itself performing work attributable to a
> project** — today, the council view with a project id.

- The new branch matches **only** `rendererView === 'council'` **and** a non-null project id.
- It yields a slot with **that projectId and `sessionId: null`** — the council is project work
  without being pane work, and `sessionId` non-null is reserved for `pane` (`AttentionSlot`'s own
  comment says so).
- **Everything else is untouched.** `settings` → `overhead`. Council without a project →
  `overhead`. A view added in Phase 4 or 5 → `overhead`, by construction, with nobody having to
  remember a list.

**⚠ Placement relative to `blurred` / `idle` / `locked` matters and is not a matter of taste.** A
blurred window is not attention on the council however good the intent — the earlier guards exist
because they describe the human, not the view. **The council branch goes after every guard that
describes whether the user is present at all, and before the generic `overhead` fallback.**

## 3. Carrying the id

`App.vue` already holds both facts — `activeView` and the project id it passes to `CouncilView`.
The attention report is assembled there. Carry the id through **only when `activeView === 'council'`**;
send `null` otherwise, so the renderer cannot leak an attribution from a view that is not doing the
work.

**⚠ D14: the payload crossing the bridge must be a PLAIN object.** If a reactive value is involved,
snapshot it. This is the failure with no compile-time signal.

**If the report payload gains the field, that is a RESHAPE of an existing channel** — no new
channel, `IpcChannel` stays 57. Declare it in the report the way D80 was declared.

## 4. Runtime proof (G2)

**Both directions, or the proof is worthless:**

1. Select a project, open the council view, leave it focused for a measurable interval → the
   interval is credited to **that project**, `sessionId` null.
2. With **no** project active, open the council view for a measurable interval → credited to
   **`overhead`**.

⚠ **`GetLastInputInfo` does not see CDP keystrokes** (standing memory): if the idle timer
interferes, use `keybd_event` SHIFT pulses with the window foregrounded, not CDP input.

**Read the result from `attention_spans` in the real DB** — `%APPDATA%\chorus\chorus.db`, via
`ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <script>` from the repo root,
forward slashes, app stopped first so the WAL checkpoints.

**⚠ Verify against the SCHEMA, not against expectation.** D70's cautionary tale is precisely this:
a flagged raise reasoned from memory about `attention_spans`, asserted a `view` column that does
not exist, and came one ratification away from being adopted as fact. **Dump the columns first.**

## 5. What must NOT change

- No sixth `AttentionClass`.
- No `view` column on `attention_spans`.
- `coverage()`'s accounting identity — **every tick in exactly one class** — still holds, and the
  test suite says so.
- `settings` and every future view stay `overhead` **by construction**, which is D70's surviving
  property and the reason this is an amendment rather than a reversal.

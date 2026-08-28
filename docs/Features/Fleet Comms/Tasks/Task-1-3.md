# Task 1-3 — The wire and the honest chip

**Phase:** Fleet Comms 1 · **Depends on:** Task 1-2 · **Owns:** `src/shared/ipc.ts` (one channel + schemas), `src/preload/index.ts` (forwarder), the renderer store slice, `TerminalPane.vue` (the chip)

---

## Source Of Truth

- Spec **§6.1** (the addressing rule — binding), **§7.1** (the chip, including why it is not free).
- `Tasks/Phase-1-Overview.md` §6 gate **G-C** (byte-wise edits).
- `ImplementationSpecs/ImplementationSpec-1-3.md`.
- `CLAUDE.md`: all IPC typed and Zod-validated **in main only**; the preload is a narrow, Zod-free
  forwarder (a Zod import there throws `EvalError` under CSP and silently drops events); payloads
  crossing the bridge are **plain objects**, never Pinia proxies.

## Initial Starting Point (verified 2026-08-27 at `07708c8`)

- `IpcChannel` has **111** entries (`src/shared/ipc.ts:14`).
- The pane header is `TerminalPane.vue:1235` `<div class="pane-header">`, with
  `<div class="pane-header-row">` at `:1236` and `<span class="pane-title">` at `:1238`.
- ⚠ **`TerminalPane.vue` has mixed line endings**: **2064 CRLF, 1 LONE CR, 2124 bare LF**, measured
  byte-wise. A text-mode round-trip splits the lone-CR line and produces a phantom diff of
  thousands of lines.
- Task 1-2 exposes a `FleetSnapshot` in main. Nothing reaches the renderer yet.

## Goal

Carry the fleet snapshot from main to the renderer over one typed, Zod-validated channel, and render
each claude pane's **current** address in its header with exactly three states. The chip must be
incapable of displaying a cached promise: it renders what the last validated poll said, or it
renders `unknown`.

## Exact Scope

- **Edit** `src/shared/ipc.ts` — one new channel and its payload schemas (**111 → 112**).
- **Edit** `src/preload/index.ts` — the forwarder only. **No Zod.**
- **Edit / create** the renderer store slice holding the latest snapshot.
- **Edit** `src/renderer/src/components/TerminalPane.vue` — the chip in the header. **Byte-wise.**

Nothing else. No roster (Task 1-4).

## Non-Goals

- **No Zod in the preload.** It throws `EvalError` under this app's CSP and silently drops events —
  a failure that looks like a backend bug for hours.
- **No polling from the renderer**, and no `fs` anywhere near it. The renderer receives a push.
- **No caching of the address across a disconnect.** If the snapshot goes stale or unreadable, the
  chip shows `unknown`; it does **not** keep showing the last good name. This is the single most
  important behaviour in the task.
- No composer, no click-to-message, no reply affordance, no unread mark, no notification, no
  pulsing.
- No roster, no timeline.
- Do not restyle the pane header beyond adding the chip. Do not touch the activity light.
- Do not revert, stage, or commit `.mcp.json`.

## Dependencies

Task 1-2 merged — this task serves *its* snapshot and computes nothing of its own.

## Step-by-step Work

1. **Add the channel.** One push channel carrying the whole snapshot keyed by Chorus session id.
   Follow the `project:attention` precedent (`ipc.ts:50`) rather than inventing a shape: one channel,
   pushed on change, deduplicated in main against the last payload so a stable fleet costs **zero
   messages** at the poll rate.
2. **Schemas in `shared/ipc.ts`, validated in main.** The address state is a discriminated union on
   `kind` with exactly the three members from Task 1-1.
3. **Snapshot before sending.** Anything sourced from main-side reactive or class state is
   `JSON.parse(JSON.stringify(x))`'d before it crosses — D14: Electron's structured clone rejects a
   proxy with *"An object could not be cloned"* and **no compile-time signal**.
4. **Preload forwarder** — a typed passthrough, nothing else.
5. **Store slice** — holds the last snapshot and exposes a per-session lookup. It stores **no
   address**; it stores the snapshot and reads through it, so there is no cached copy to go stale.
6. **The chip.** In `pane-header-row`, after `pane-title`. Rendering, per §6.1:
   - `verified` → the address, plainly: `Mae`
   - `changed` → both, with the current one dominant: `Requested Mae · now redesign-dictation-overlay`
     (append ` · collision` only when `cause === 'collision'`)
   - `unknown` → `Address unknown`
   - a **non-claude pane** → `Not addressable`, rendered as a fact rather than an error state
7. **⚠ Edit `TerminalPane.vue` byte-wise (G-C).** Read as a Buffer, splice, assert the lone-CR count
   is still 1 and the CRLF/LF counts are unchanged except for the lines you added. Verify with
   `git diff --stat` that the diff is the size of your change, not thousands of lines.

## Test Expectations

- Schema tests in the existing `src/shared/ipc.test.ts` style: each of the three `kind` values
  round-trips; a fourth `kind` is **rejected**; a payload missing `kind` is rejected.
- A store test: given a snapshot, a session resolves to its state; an **absent** session resolves to
  `unknown` rather than `undefined` — absence is a state, not a gap.
- ⚠ A test that the store, after receiving `unknown` for a session it previously had `verified` for,
  reports `unknown` — **the no-stale-address rule, asserted directly.**
- A `TerminalPane` render test per the file's existing conventions, covering all four rendered
  cases including `Not addressable`.

## Verification Commands

```
npm run typecheck
npx vitest run
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8');const i=s.indexOf('export const IpcChannel = {');const seg=s.slice(i,s.indexOf('} as const',i));console.log('IpcChannel entries:',(seg.match(/^\s{2}[A-Za-z0-9_]+:\s*'/gm)||[]).length)"
node -e "const b=require('fs').readFileSync('src/renderer/src/components/TerminalPane.vue');let crlf=0,lone=0,lf=0;for(let i=0;i<b.length;i++){if(b[i]===13){b[i+1]===10?crlf++:lone++}else if(b[i]===10)lf++}console.log({crlf,loneCr:lone,bareLf:lf})"
git diff --stat -- src/renderer/src/components/TerminalPane.vue
```

Expect **112** channels, `loneCr: 1` still, and a `git diff --stat` in the tens of lines — **not
thousands**. A four-figure diff on that file means G-C was violated; revert and redo byte-wise.

**Runtime gate (G-A) — run it.** With the dev app up and two claude panes:

- each pane's header shows its current address;
- rename one pane's peer out from under it (launch a second session claiming the same name, or wait
  for a real drift) and confirm the chip shows `changed` with both names **and keeps showing it**
  across later polls rather than flashing once;
- make the registry unreadable and confirm the chip goes to `Address unknown` and **does not keep
  showing the last good name**;
- confirm a codex pane reads `Not addressable`.

## Acceptance Criteria

- `IpcChannel` reads **112**.
- No Zod import exists anywhere under `src/preload/`.
- `TerminalPane.vue` still measures `loneCr: 1`, and its diff is proportionate.
- The chip renders all four cases in the running app, observed, not inferred.
- No path exists by which a previously-good address survives an `unknown` snapshot.

## Review Checklist

- [ ] The renderer stores a snapshot, never an address — there is no field that could go stale.
- [ ] `unknown` is reachable and visibly different from "no peers".
- [ ] Payloads are plain objects; nothing reactive crosses the bridge (D14).
- [ ] Preload is Zod-free.
- [ ] The `changed` chip shows both names, current dominant, and persists.
- [ ] `Not addressable` reads as a property of the agent, not a failure.
- [ ] `TerminalPane.vue` was edited byte-wise and the diff proves it.

# Task 3b-4 — The Council View, Brief In → Findings Out

_Phase 3b, Task 4 of 4. **This task CLOSES Phase 3b.**_

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3b-Overview.md`, and `ImplementationSpec-3b-4.md` for exact contents.
- Roadmap §4 (the CR mechanism, and the **format** the findings `.md` must match), §6: **D14**, **D21** (the palette registry), **D27** (what this feature is for), **D63(f)** (the sanitization pre-pass), **D64(1)** (view/route, not a pane).
- **F27** — the redaction wording this task may not overstate.

## Initial Starting Point

After 3b-3. `CouncilService` runs a deliberation from brief **text** and returns findings **text**; `council:progress` broadcasts scrubbed deltas; runs and messages persist. **Nothing reads or writes a file, and nothing renders.**

- `src/renderer/src/palette/commands.ts` is a **pure registry** — `buildCommands(ctx)` producing groups, each command with `id` / `label` / `enabled()` / `run()`. Existing ids include `launch`, `manage-worktrees`, `settings.open`. **No store imports, no `window.chorus`, no Zod.**
- `CommandPalette.vue` and `LaunchDialog.vue` share an overlay/focus-trap idiom worth reusing.
- The `session:launch` handler carries the repo's **file-path security boundary** precedent: absolute path required, `fs.existsSync` checked, in **main**, never trusting the renderer.

## Goal

Close the loop D27 opened: **point Chorus at a brief `.md`, watch the deliberation, get a findings `.md` beside it** — the same format §4 has used since Phase 1, produced by the app instead of by Cursor.

The dogfood check is the milestone: **a real Chorus governance CR runs natively end-to-end.**

## ⚠ Two things this task must get right, and neither is the UI

**1. The brief path is a SECURITY BOUNDARY, not a form field.** A renderer-supplied path that main opens is an arbitrary-file-read primitive if unvalidated, and the findings write is an arbitrary-file-**write** primitive, which is worse. Both are validated in **main** — absolute, existing, `.md`, and inside a directory the user chose — following the `session:launch` cwd precedent exactly. **Never trust the renderer**, and never let the findings path be independently supplied: it is **derived** from the brief path, so there is one thing to validate rather than two.

**2. ⚠ The sanitization pre-pass, and the claim it does NOT license (D63(f), F27).** A brief may quote a key — Chorus's own council briefs quote configuration, and a user's brief might quote anything. The scrubber **cannot** catch it, because it exact-matches *registered* values and a brief-quoted key was never registered. So the brief is scanned **before** it reaches any member, using **`src/main/services/secret-patterns.json`** — already the ONE list shared by `logger.ts`'s `scrubSecrets` and `scripts/secret-grep.mjs`. **Authoring a second pattern list is forbidden**: it would let the G4 gate and the sanitizer test different shapes, which is the exact drift that file's header exists to prevent.

**And the wording stays honest.** The pre-pass catches *known shapes*. It cannot catch a credential that looks like prose. The only sentence this task may ship:

> *Chorus redacts registered exact values on ingest and scans briefs for known credential shapes. It cannot redact values an agent derives, and it cannot recognize a secret it has no pattern for.*

**Never "your brief is safe."**

## Exact Scope

- **EDIT** `src/main/services/councilService.ts` — brief read, findings write, path validation, the sanitization pre-pass.
- **EDIT** `src/main/ipc.ts` / `src/shared/ipc.ts` / `src/preload/index.ts` — the brief-path channel (a main-side `dialog.showOpenDialog`, the `project:add` precedent — **cancel is a structured no-op**), and `council:start` widened to take a validated path.
- **CREATE** `src/renderer/src/views/CouncilView.vue` — the run surface: member roster, live deliberation, the findings result.
- **CREATE** `src/renderer/src/stores/council.ts` — run state, progress subscription, with the store-level `loadSeq` supersede token idiom.
- **EDIT** `src/renderer/src/palette/commands.ts` (+ test) — the "Run council…" command.
- **EDIT** `src/shared/ipc.test.ts`.
- **CREATE (untracked)** `_verify/3b-4/`.

## Non-Goals

- **NO layout-tree pane** (D64(1)) — a view/route, so **D45(3) stays entirely out of this phase**: no versioned layout migration, no non-OSC auto-titling, no capability branching in `LaunchDialog` or the worktree panel.
- **NO migration.** v11 was the phase's only one.
- **NO protocol change.** 3b-3's ruled protocol is consumed, not revised.
- **NO second api transport, no second scrubber, no `fetch` in the renderer.**
- **NO writing anywhere but beside the brief.** No temp files, no app-data copies, no "recent findings" cache. **One derived output path.**
- **NO board, no dashboard, no history browser.** Runs persist; rendering the archive is not this phase.
- **NO editing the brief in-app.** Chorus reads it; the user's editor writes it.
- **NO auto-run**, no watcher, no scheduled council. Every run is a user gesture — which is also what keeps D60's invariant true by construction.
- **Do not touch** the two `TASK-*-REVIEW-FABLE.md` files.

## Dependencies

**Task 3b-3** committed, including its CR findings recorded as a numbered decision.

## Step-by-step Work

1. **The path boundary first**, in main, with its refusals tested before any UI exists.
2. **The sanitization pre-pass**, reusing `secret-patterns.json`. **What happens on a hit is a real decision:** refuse the run, or redact and proceed with a visible warning? **Refusing is the safer default** — a user who wrote a key into a brief should know before five models read it — and whichever is chosen must be stated in the commit, not left to the code.
3. **Findings write**, derived path, with the §4 format.
4. **The store and the view**, progress subscription over the broadcast.
5. **The palette command**, following the pure-registry rules.
6. **Tests, gates, and the dogfood drive.**

## Test Expectations

Path validation gets the exhaustive table, in main, with no filesystem: relative path; non-existent; a directory; not `.md`; a traversal attempt (`..`); a UNC path; a path with a null byte. **Each is a refusal with a message naming no path fragment that was not supplied.**

Sanitization: a brief containing each known pattern is caught; a brief containing a 40-char git SHA, a Windows path, a UUID and a `chorus/<repo>/<8hex>` branch name is **not** caught (the false-positive guard `logger.test.ts` already establishes for the same list).

Palette: the command appears, and `enabled()` is false when no project is active.

## Verification Commands

```powershell
npm run typecheck
```
```powershell
npx vitest run
```
```powershell
npm run grep:secrets
```

### Grep gates

- **zero** `fetch(` and **zero** `fs` in any renderer file;
- **exactly one** findings-write call site in `councilService.ts`;
- **zero** new secret-pattern literals — `secret-patterns.json` is imported (D63(f));
- `src/main/adapters/` diff **empty**; `sessionManager.ts` **byte-identical**; `MIGRATIONS.length` still **11**;
- **exactly 1** new `.vue` file, the one in Exact Scope.

### ⚠ The dogfood drive (G2) — the phase milestone

**Run a real Chorus governance CR natively, end to end**, on the real DB. Point the council at an actual brief in `docs/Features/Foundation/CouncilBriefs/`, watch the deliberation stream, and read the findings `.md` it writes.

Assert, quoting evidence: the findings file lands **beside the brief** with the §4 format; the transcript persisted with rounds and phases; **dissents are present** in the output where the deliberation actually disagreed; the run's key was minted, used, read back and **revoked**; and `npm run grep:secrets` is clean **including over the written findings file**.

**Then the honest comparison:** hold the native findings beside `CouncilBrief-3b.0-Findings.md`, produced externally. **Report where the native run is weaker.** Phase 3b's milestone is that a real CR runs natively — not that it runs as well, and a report claiming parity without the comparison has not earned it.

### ⚠ Cost envelope

**Under $0.30.** The dogfood run is on a real brief, which is long, and input tokens scale with it for every member. **Drive everything else with a stub brief of a few lines.** Report actual cost. **If the dogfood run alone exceeds $0.20, report before running a second.**

## Acceptance Criteria

1. The palette command opens the view; a brief chosen through a main-side dialog runs a council; the findings `.md` lands beside the brief in §4 format.
2. Path validation refuses every case in the test table, **in main**, and the findings path is **derived**, never supplied.
3. The sanitization pre-pass reuses `secret-patterns.json` with **zero** new pattern literals, and the hit behaviour is stated in the commit.
4. The shipped wording matches §"Two things" above — **no "your brief is safe"** anywhere in UI, docs or commit.
5. Live progress renders from the **scrubbed** broadcast, never a raw stream.
6. The dogfood drive passes, **with the honest comparison against the external findings reported.**
7. `grep:secrets` clean over `src/`, `_verify/3b-4/`, **and the written findings file**.
8. Typecheck 0; vitest green; exactly one new `.vue`; no migration; adapters untouched.
9. Cost reported against the **< $0.30** envelope.
10. Every phase non-goal confirmed held: no layout pane, no second transport, no second scrubber, no `dispatches` write, `agentKindSchema` unchanged, `staticRegistry` unchanged, `startApiSession` still dormant.

## Review Checklist

1. **Is the findings path derived, or supplied?** A renderer-supplied write path is the most serious defect available in this task.
2. **Does the pre-pass import `secret-patterns.json`**, or did someone paste a regex? A second list is a silent divergence from the G4 gate.
3. **Is the progress broadcast fed from `SessionOutput.onText`**, or from the raw stream? Bypassing the seam at the last hop is where it is least visible.
4. **Does any shipped sentence overclaim redaction?** F27's wording is not optional and this is the first surface a user reads it on.
5. **Was the comparison against the external findings actually done and reported**, including where the native run is worse?
6. **Does the view present findings as deliberation rather than fact?** CR-3b.0's four compile errors are the standing evidence for why that distinction is load-bearing.

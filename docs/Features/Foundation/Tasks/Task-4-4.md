# Task 4-4 — OS Delivery: Toast → Focus-Pane + Tray Badge

_Phase 4, task 4 of 4. **One narrated commit (G3).** The phase's last task, and **the only one whose main half cannot be seen working on this machine.** This task governs scope; `ImplementationSpecs/ImplementationSpec-4-4.md` governs exact contents._

> **⚠ HALF OF THIS TASK IS UNVERIFIABLE HERE, AND THAT IS WHY IT IS LAST RATHER THAN WHY IT IS SMALL.** `ToastEnabled=0` at the registry level on this machine; **every** OS toast fires and fails with `HRESULT: -2143420140`. `notifications.ts:34–35` already logs `[notify] toast shown` / `[notify] toast failed` for exactly this reason, and Task 4a-3 used that instrument successfully. **The toast half is verified by log assertion; the tray half is verified by looking at it.** Do not conflate the two kinds of evidence in the commit message.

## Source Of Truth

- `Tasks/Phase-4-Overview.md` — §5; `Tasks/Task-4-3.md` — the policy this task must **obey rather than reimplement**.
- `docs/PLAN.md:200` — *"Delivery: OS toast (click focuses the exact pane) · tray badge count · in-app notification center"*. The third is built (4-3); this is the first two.
- Roadmap §6 **D143(b)** — the exit-listener storm, and the suppression seam that stops a deliberate relaunch firing a real-looking failure.
- Roadmap §5 — `sessions.onExit(` registrations: **8 at `756066c`**, **9 after Task 4-3**. Update the figure again if this task adds one.
- `src/main/services/notifications.ts` (45 lines) — the file this task finally edits.

## Initial Starting Point — verified at `00f0f0d`

| Location | State today |
|---|---|
| `notifications.ts:23` | `watchSessionExits(sessions)` — toasts on **every** exit, clean or not |
| `notifications.ts:28` | the `Notification` body: `${label} exited (code ${exitCode})` |
| `notifications.ts:36` | `toast.on('click')` — **focuses the WINDOW, not the pane**: `win.show(); win.focus()` and nothing more |
| `notifications.ts:11` | `AGENT_LABELS: Record<AgentKind, string>` — exhaustive by construction |
| `index.ts:145`, `:303` | `new BrowserWindow({ ... icon: appIcon })` |
| `resources/icon.ico`, `resources/icon.png` | the app icons that exist |
| Electron | **^43.1.1** |
| — | **No `Tray`, no `setOverlayIcon`, no `setBadgeCount` anywhere in `src/`** |

## Goal

Make the OS layer obey the policy that already exists, and give it the two affordances PLAN.md names: **a toast whose click lands on the exact pane**, and **a count visible without opening the app**. Nothing here decides *what* is worth notifying — Task 4-3 already did.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/notifications.ts` | **Edit.** Obey the policy; carry the sessionId; focus the pane on click. |
| `src/main/services/notifications.test.ts` | **Create.** See Test Expectations. |
| `src/main/services/trayBadge.ts` | **Create.** The count surface, with its pure part separated. |
| `src/main/services/trayBadge.test.ts` | **Create.** |
| `src/main/index.ts` | **Edit.** Construct/dispose the badge alongside the existing window wiring. |
| `src/shared/ipc.ts` + `src/main/ipc.ts` | **Edit — only if a channel is genuinely needed.** See below. |
| `src/renderer/src/App.vue` | **Edit — only if focusing a pane from main needs a renderer hop.** |

**⚠ THE LAST TWO ROWS ARE CONDITIONAL, AND THE CONDITION IS TO BE RESOLVED BY READING THE CODE, NOT BY ASSUMING.** Main can raise and focus the window on its own; it **cannot** move DOM focus to a specific terminal. If an existing channel already carries "focus this session", use it and add nothing. If not, one channel is justified — **and then `IpcChannel` moves from 91 to 92 and both assertions must move with it** (G6/F54). Say which you found, in the commit.

## ⚠ Two OS APIs, and neither may be hardcoded from memory

**CLAUDE.md's D4 rule is about CLI flags, and it applies here for the identical reason: this is a platform surface whose behaviour differs by OS and by version, and this app is Windows-only v1.**

- **`app.setBadgeCount()` is documented as macOS and Linux.** On Windows the taskbar affordance is **`BrowserWindow.setOverlayIcon(image, description)`**, which needs a generated image rather than a number.
- **`Tray` is a separate surface again**, with its own icon and its own lifetime, and it must be held in a variable that outlives the call or it is garbage-collected and vanishes.

**Verify against Electron 43's own documentation and against this machine before committing to either.** Report which one you used and what you saw. **A badge that silently does nothing on Windows is this phase's failure mode repeating itself** — that is exactly what the toast already does.

## ⚠ The toast must obey the policy, which is a NARROWING of what ships today

`notifications.ts:24` currently toasts **every** exit. Task 4-3's policy says failures only, never the focused pane, and nothing for a null exit code. **After this task, closing a pane normally produces no toast.** That is intended, it is a user-visible behaviour change, and it must be stated in the commit rather than discovered.

**⚠ AND D143(b) APPLIES DIRECTLY HERE — IT IS THE DEFECT THIS FILE ALREADY CAUSED ONCE.** When a resume failure triggers an automatic relaunch, the exit fan-out fires and *"the run before the fix logged `[notify] toast shown: Claude Code exited (1)`"* for a session that came straight back. Route through the same suppression seam; **do not invent a second one**.

## Non-Goals

- **No policy logic.** Import `decide()`; do not re-implement, extend or "improve" it. A second copy of the rules is how the toast and the centre start disagreeing about what happened.
- **No new notification kind.** If the OS layer wants to say something the centre does not, that is a policy question and it belongs in 4-3.
- **No sounds.** PLAN.md lists them as optional; they need an asset decision and are not in this phase.
- **No webhook, no Telegram/Hermes bridge.** PLAN.md marks it "Later".
- **No AUMID/app-registration work, no attempt to defeat `ToastEnabled=0`.** The registry setting is the user's machine configuration, not a bug to route around. The in-app centre is the answer and it already shipped in 4-3.
- **No table, no migration.** `MIGRATIONS.length` stays **19**; `sqliteTable(` stays **18**.
- **No change to `agentEvents.ts`, `agentEventsCore.ts`, `attentionRollup.ts`, `attentionInboxCore.ts`, `notificationPolicyCore.ts`, `turns.ts`.**
- **Do not revert, stage, or commit unrelated or untracked files** — see Overview §7.

## Dependencies

**Task 4-3** — the policy and the centre. This task is the third delivery channel for a decision already made.

## Test Expectations

`Notification` and `Tray` are Electron singletons and Vitest runs under plain Node, so **the split is the test strategy**: put the arithmetic in a pure function and let the Electron call be the thin part.

1. **`trayBadge` pure part** — count → tooltip/description text, including **zero** (which must clear rather than render "0"), **one** (singular), and a large number.
2. **`notifications`** — the policy is consulted and a suppressed verdict produces **no `new Notification`**. Inject the Electron seam (the `AttentionTracker`/`readIdleSeconds` precedent in `attention.ts:129` is the house idiom for exactly this).
3. **The label map stays exhaustive** — `Record<AgentKind, string>` already forces this at compile time (`notifications.ts:6` records it catching D86 and D90); do not weaken it to a `Partial` or an index signature to make a test easier.

**No test count regression.**

## Verification Commands

```bash
npm run typecheck          # 0, node + web
npm test                   # no regression
npm run grep:secrets       # clean
grep -c "sqliteTable(" src/main/db/schema.ts        # 18
grep -n "toHaveLength(" src/shared/ipc.test.ts      # 91, or 92 if a channel was justified — BOTH sites agree
```

## Acceptance Criteria

1. Typecheck 0; tests green, no regression; secret-grep clean.
2. `MIGRATIONS.length` **19**; `sqliteTable(` **18**. If `IpcChannel` moved, both assertions moved together and the reason is in the commit.
3. **Runtime — the tray badge, which DOES work on this machine and is therefore proven by sight.** Two sessions driven to a waiting state: the count reads **2**; answering one takes it to **1**; answering the last **clears it** rather than showing "0". Screenshot each.
4. **Runtime — the toast, proven by LOG rather than by sight, and labelled as such.** A failing session on an unfocused pane logs `[notify] toast shown: …` immediately followed by `[notify] toast failed: …` with `HRESULT: -2143420140`. **That is the expected outcome on this machine and it is a PASS** — the code path ran and the OS refused. Quote both lines.
5. **Runtime — the narrowing, driven in both directions.** Close a pane normally → **no** `[notify]` line at all. Kill one with a non-zero code → the two lines from (4). The absence is the evidence.
6. **Runtime — D143(b).** Force a resume failure so the automatic relaunch fires the fan-out → **no `[notify]` line**. This is the exact before/after D143(b) itself was proven with.
7. **Runtime — focus-on-click, and it needs an honest answer.** `ToastEnabled=0` means the toast cannot be clicked here. **Either** drive the click handler directly and show the pane took DOM focus, **or** state plainly that the click path is unverified on this machine and say which line is untested. **⚠ DO NOT CLAIM IT WORKS BECAUSE THE CODE LOOKS RIGHT** — F66 is in this repo precisely because a classifier that looked right matched nothing against real bytes.
8. The tray icon **survives** — still present after five minutes and after a window minimise/restore. A `Tray` held in a local goes away silently.

Evidence under `_verify/4-4/`.

## Review Checklist

- [ ] `decide()` is **imported**, not reimplemented — grep the diff for a second threshold or a second focus check.
- [ ] The Windows badge API was **verified against Electron 43's docs and this machine**, not assumed. Which one, and what was seen, is in the commit.
- [ ] The `Tray` (if used) is held in module or class scope, not a local.
- [ ] D143(b)'s suppression seam is reused; no second mechanism.
- [ ] `Record<AgentKind, string>` still exhaustive.
- [ ] The behaviour narrowing (no toast on clean exit) is stated in the commit message.
- [ ] Toast evidence is labelled **log-asserted**; tray evidence is labelled **observed**. The two are not merged into one claim.
- [ ] Anything genuinely unverifiable on this machine is **named**, per the phase's failure-honesty rule.
- [ ] No migration, no new table, no npm dependency.

---

## Phase close

This is the last task. On landing, re-measure §9 of `Phase-4-Overview.md` and record the pass in roadmap §5, superseding the `00f0f0d` block rather than editing it. Note explicitly whether the phase's milestone — *"agent attention events reliably surface in-app regardless of OS toast state"* — is **met**, and on what evidence. **It is an in-app claim, and the in-app half is fully verifiable here**, so this one can be answered without hedging.

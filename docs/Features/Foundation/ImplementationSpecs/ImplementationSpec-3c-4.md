# ImplementationSpec 3c-4 — Overlays and Dialogs

**Normative for:** [`../Tasks/Task-3c-4.md`](../Tasks/Task-3c-4.md).

## 1. The shared overlay anatomy

All three mocked overlays share a treatment, and it should be extracted once rather than written
three times — a small `<OverlayShell>` wrapper or a shared class set, implementer's choice, but
**one home**:

- **Scrim** over the workspace, dimming without hiding it.
- **Panel** on `--color-surface-card` (`#12151A`) with `1px solid --color-border-inset`
  (`#1D232A`) and `--radius-card` (6px).
- **Keycap hints** in the shared style: `--font-mono` `9.5px`, `1px solid
  --color-border-divider`, background `--color-surface-keycap`, radius 3px, padding `1px 5px`.
- **Eyebrow labels** as in the rail: mono, `9.5px`, `.18em` tracking, `--color-text-eyebrow`.

**⚠ Do not change any overlay's open/close mechanics while extracting this.** `anyOverlayOpen`
in `App.vue` feeds the attention report; an overlay that stops reporting itself makes the app
credit dialog time to a terminal pane, and per **D50** that telemetry cannot be corrected later.
The wrapper is presentational only.

## 2. `CommandPalette.vue`

Read the geometry from the Workspace mock's `<!-- ══ command palette (ctrl+k or tweak) ══ -->`
block. The selected row is the element to get exactly right — it is the only affordance telling
the user what Enter will do.

Command rows show their label in `--color-text-primary` and any hint in `--color-text-quiet`.
**Disabled commands** — `council.run` is disabled without an active project — must read as
disabled by more than opacity alone: keep the mock's treatment and ensure the reason is legible.

**Do not touch `palette/commands.ts`.** The command list, its ids, and its `hasActiveProject`
gating are behaviour and are asserted by `commands.test.ts`.

## 3. `LaunchDialog.vue`

647 lines and the largest job in this task. Work **top-down through the mock**, section by
section, rather than by search-and-replacing color classes — the mock has a real information
hierarchy (profile, agent, route, model, effort, worktree) and the current dialog's visual
hierarchy is flat.

**Preserve exactly:** the profile → route → model resolution and **D56's precedence order**,
which is expressed in main and must not be re-implemented or second-guessed in the view; the
effort vocabulary (`fast | balanced | deep | max`); the `extra_args` input and **its D59 warning
about argv being world-readable** — if that warning is rendered today, it stays rendered, and its
wording does not change.

**Model input stays free text with an additive `<datalist>`.** D56's third enforcement site is
that this is **never a closed `<select>`**. A restyle that turns it into a dropdown for
neatness breaks a normative ruling. This is the most likely well-intentioned mistake in the task.

## 4. `EmptyState.vue`

20 lines against the Startup mock. Small, and the first thing seen on a cold boot with no
project — worth getting right for that reason alone. The add-project route from here and the one
in 3c-3's rail should read as the same action.

## 5. `WorktreePanel.vue` — conformance only

**Mechanical substitution, nothing else.** Map stock utilities to tokens:

| Stock (current) | Token |
|---|---|
| `bg-neutral-900` | `--color-surface-card` |
| `bg-neutral-800` | `--color-surface-badge` |
| `border-neutral-800` / `-700` | `--color-border-inset` |
| `text-neutral-100` | `--color-text-primary` |
| `text-neutral-300` / `-400` | `--color-text-body` / `--color-text-tertiary` |
| `text-neutral-500` | `--color-text-quiet` |
| `text-red-400` | `--color-state-error-text` |
| `text-amber-300` | `--color-state-attention-text` |

Where the panel shows a worktree's state, use `StateMarker` if a state maps cleanly; **if none
does, leave the existing indicator alone** rather than inventing a fifth state shape. The
vocabulary is four shapes and adding a fifth is a design decision.

**The diff must read as class churn.** If elements moved, this spec was exceeded.

**⚠ The removal confirmation is a gated destructive path with F21 attached.** Its logic, its
required confirmation text, and its wording are untouchable here. Restyle the container; leave
the mechanism alone.

## 6. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -rn "neutral-\|sky-\|zinc-\|slate-\|gray-\|red-[0-9]\|amber-[0-9]\|emerald-" src/renderer/src/components/{LaunchDialog,CommandPalette,EmptyState,WorktreePanel}.vue   # expect nothing
git diff --stat src/renderer/src/palette/                                  # expect: empty
```

**Runtime, over CDP:**

1. Screenshot the palette, the launch dialog **in four states**, the startup screen, and the
   worktree panel.
2. **Behaviour re-check** as listed in the task doc — the palette's keyboard path, a real launch,
   the worktree lifecycle including the gated remove, and `anyOverlayOpen` still flipping.
3. **Confirm the model input is still free text** — inspect the element; it must be an `<input>`
   with a `<datalist>`, not a `<select>`.

## 7. Deliberately out of scope

- **A redesign of `WorktreePanel.vue`** — the phase's one declared visual gap, recorded in the
  milestone amendment. Closing it needs a mock, and a mock needs Matthew.
- **The Attention Inbox** (Phase 4) — its mock exists and is not this task's.
- **Any change to command definitions, launch resolution, or worktree lifecycle.**

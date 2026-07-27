# ImplementationSpec 3c-3 — The Workspace

**Normative for:** [`../Tasks/Task-3c-3.md`](../Tasks/Task-3c-3.md). The mock
(`docs/design/v2/Chorus Workspace.dc.html`) wins on appearance; **D76** wins on which facts appear
at all.

## 1. Shell layout

After 3c-2, `App.vue`'s root is a column: `TitleBar` (36px, `flex:none`) · body (`flex:1;
min-height:0`) · `StatusBar` (30px, `flex:none`). The body is a row:

```
ProjectRail (208px, flex:none) │ view (flex:1, min-width:0) │ Filmstrip (right rail, flex:none)
```

`min-width: 0` on the centre column is the horizontal twin of `min-height: 0` — without it a long
pane title refuses to ellipsize and pushes the filmstrip off-screen.

**The rail and filmstrip render in the workspace view only.** Settings and Council are
full-window routes below the titlebar (`App.vue:342–353`); the titlebar and status bar span all
three, the rail and filmstrip do not.

## 2. `ProjectRail.vue`

Root: `width: 208px; flex: none;` background `--color-surface-rail` (`#0B0D10`),
`border-right: 1px solid --color-border-chrome`, `padding: 10px 0 8px`, column flex.

Eyebrow: `padding: 2px 14px 8px`, `--font-mono`, `9.5px`, `letter-spacing: .18em`,
`--color-text-eyebrow`, text `PROJECTS`.

Items: `padding: 0 8px`, `gap: 2px`. Each item is `position: relative`,
`border-radius: --radius-rail` (5px), `padding: 9px 10px 9px 14px`.

| | active | inactive |
|---|---|---|
| background | `--color-surface-selected` (`#13171C`) | transparent, hover `--color-surface-hover` (`#101318`) |
| border | `1px solid --color-border-inset` (`#1D232A`) | `1px solid transparent` |
| label | `13px`, weight 600, `--color-text-primary` | `13px`, weight 500, `--color-text-secondary` |
| sub-line | `--font-mono`, `10px`, `--color-text-quiet` | same, `--color-text-eyebrow` |

**The spine:** `position:absolute; left:0; top:8px; bottom:8px; width:2px; border-radius:1px`.
Active is `--color-accent-periwinkle`; inactive projects use a **dimmed per-project color**
(`rgba(208,138,78,.55)` for the second project in the mock, with `--color-spine-violet` and
`--color-spine-sand` as the other two). Assign deterministically by project index — **not
randomly, and not by hashing the name**, so a project's color does not change when it is renamed.

**Attention badge**, when a project has sessions needing input:
`background: rgba(245,158,11,.10); border: 1px solid rgba(245,158,11,.35); border-radius: 3px;
padding: 1px 6px 1px 5px`, containing `<StateMarker state="needs-you" />` and the count in
`--font-mono` `10px` `--color-state-attention-text`.

**Sub-line — ⚠ D76.** The mock reads `5 sessions · $1.94`. **Render `5 sessions`. Omit the
cost.** There is no per-project cost source: `attribution:summary` is account-scoped and windowed
(F35). Do not render `$0.00`, `—`, or a loading skeleton.

**The add-project affordance must survive.** `ProjectTabs.vue` had `+ Add Project` calling
`store.add()`; the mock's rail does not draw one. **Place it at the bottom of the rail** as a
quiet full-width row in `--color-text-quiet` that brightens on hover. **⚠ This is the single most
likely behavioural regression in the whole phase** — a rail written as a `v-for` over projects
drops the only route to adding one, and the app has no other.

## 3. `StatusBar.vue`

Root: `height: 30px; flex: none;` background `--color-surface-chrome` (`#0A0B0D`),
`border-top: 1px solid --color-border-chrome`, `display:flex; align-items:center; gap:14px;
padding: 0 14px`, `--font-mono` `10.5px`, `--color-text-quiet`.

**Contents, filtered by D76:**

| Mock | Ship? |
|---|---|
| `● neo4j :7688` chip | ❌ **omit** — Neo4j is Phase 6 and does not exist |
| `worktrees 4` | ✅ from `worktree:list` |
| *(spacer)* | ✅ |
| `7 sessions · 3 running · 1 waiting · 1 error` — with `1 waiting` in `--color-state-attention-text` | ✅ from the session store |
| separator (`width:1px; height:12px; background:--color-border-divider`) | ✅ |
| `taxapp $1.94 · all $4.12 today` | ❌ **omit** — no per-project or per-day rollup exists |
| `ctrl+k commands` keycap | ✅ — `9.5px`, `1px solid --color-border-divider`, background `--color-surface-keycap`, radius 3px, padding `1px 5px`, label in `--color-text-muted` |

Two omissions means one separator instead of two. **Do not leave a dangling separator** — a
divider with nothing on one side reads as a rendering bug.

## 4. `FilmstripRenderer.vue` — the 88px card

`height: 88px; flex: none;` background `--color-surface-card` (`#12151A`), border
`1px solid rgba(124,140,248,.22)`, `border-radius: --radius-card` (6px), `padding: 9px 11px`,
column flex, `gap: 5px`.

**Row 1** (`gap: 7px`): the agent-kind tile — `16×16`, radius 3px, background
`--color-surface-badge` (`#1A2027`), border `1px solid --color-border-badge`, `--font-mono`
`8.5px`, `--color-text-badge`, holding a two-letter code (`cc`, `cx`, `ai`) — then the session
title at `12px`/500/`--color-text-primary`, ellipsized, `flex:1; min-width:0` — then
`<StateMarker :state="..." />`.

**Row 2:** the status line, `--font-mono` `10.5px`, ellipsized. Color follows state:
needs-you `--color-state-attention-text`, error `--color-state-error-text`, otherwise
`--color-text-tertiary`.

**Row 3:** `--font-mono` `10px` `--color-text-quiet`, elapsed on the left, cost on the right.
**⚠ D76: per-session cost — check whether the session store actually carries one. If it does not,
omit the right-hand figure** and leave the row as elapsed only. Do not invent it.

**State variations:**

- **needs-you** — put `data-pulse` **on the card** with `animation: chorusPulse 2.2s ease-in-out
  infinite`. **The `StateMarker` must not animate** (3c-1 spec §6); two pulsing elements is a
  different design.
- **running / error** — card hover `--color-surface-card-hover` (`#151920`).
- **done** — card background `--color-surface-card-dim` (`#101317`), border
  `rgba(124,140,248,.13)`, `opacity: .82`, tile background `--color-surface-badge-dim`
  (`#171C22`) with border `--color-border-dim` and text `--color-text-muted`.

**Filmstrip placement is the RIGHT RAIL and does not reflow** at 16+ sessions — it scrolls
vertically (settled at kickoff; see the Overview).

## 5. `TerminalPane.vue` — pane header only

Restyle the header to the mock's anatomy using **only data the pane already has**: agent-kind
tile, title, state marker, and the existing controls. **Do not add a data source to the header.**
The roadmap's phrase is "where the data already exists", and D76 is the general form of it.

**Everything below the header is out of scope** — buffer, scrollback, resize, PTY wiring, and
the `session:*` channels are untouched.

## 6. The xterm theme — the one thing that is not a Tailwind class

`TerminalPane.vue` hosts xterm.js, which takes a **JavaScript theme object**, not CSS. Left open
by 3c-1 deliberately and settled here:

- `background` must equal the pane surface so the terminal does not sit in a differently-dark
  rectangle;
- `foreground` `--color-text-body`, `cursor` `--color-accent-jade`,
  `selectionBackground` `rgba(59,207,174,.25)` to match `::selection`.
- **⚠ Do NOT restyle the 16 ANSI colors.** Those are the *agent's* output colors; overriding them
  changes what `claude` and `codex` look like when they emit color, which is a behavioural change
  wearing a styling costume, and it is not something any mock specifies. If the ANSI palette
  looks wrong against the new background, **report it** — it is a design question for Matthew,
  not an implementer's call.

Read the token values in JS via `getComputedStyle(document.documentElement).getPropertyValue(...)`
so there is still exactly one home for each color.

## 7. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -rn "ProjectTabs" src/                                          # expect nothing
grep -rn "neutral-\|sky-\|zinc-\|slate-\|gray-" src/renderer/src/components/ProjectRail.vue src/renderer/src/components/StatusBar.vue src/renderer/src/components/FilmstripRenderer.vue   # expect nothing
```

**Runtime, over CDP:**

1. Screenshot each surface; diff against the mock region.
2. **The grayscale proof** — apply `filter: grayscale(1)` to the document and screenshot the
   filmstrip with all four states present. **All four must remain distinguishable.** This is the
   only check that actually tests the colorblind-safety claim, and it is cheap.
3. `Emulation.setEmulatedMedia` with `prefers-reduced-motion: reduce` — the needs-you card holds
   the static bright shadow.
4. Behaviour re-check: project switch, project add, split, close, focus, filmstrip↔grid, and
   layout persistence across a restart.

## 8. Deliberately out of scope

- **Per-project and per-session cost** — D76. The slots are left empty on purpose; whichever
  phase adds a per-project rollup fills them.
- **The neo4j status chip** — Phase 6.
- **The Attention Inbox** — Phase 4, despite the mock existing.
- **The ANSI palette** — §6, escalate rather than decide.

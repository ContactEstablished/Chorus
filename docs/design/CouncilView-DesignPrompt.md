# Claude Design prompt — Chorus Council Review screen

**Purpose of this file.** Phase 3c (Design Adoption) turns the `docs/design/` mockups into
the running app. Every surface Chorus has today is covered by a mock **except the Council
Review view**, which shipped in Task 3b-4 after the design set was drawn. This is the prompt
to paste into Claude Design to produce that missing mock.

**How to use it.** Paste everything below the line into Claude Design. Export the result as
`docs/design/Chorus Council.dc.html`, matching the existing files' format (a single
self-contained HTML file with inline styles, a `data-screen-label` attribute, and a
1440×900 root frame). Task 3c-5 is blocked until that file exists.

**Why the prompt is this long.** The existing mocks are the design language's only written
record — there is no token file, no style guide, and no CSS custom properties anywhere in
them. Every value below was read out of `Chorus Workspace.dc.html` this session. If the new
screen is drawn from a summary instead of from these exact values, it will not match, and
Phase 3c's milestone is a screenshot diff against the mocks.

---

## The brief

Design the **Council Review** screen for Chorus, a Windows desktop app (Electron) for running
several AI coding agents in parallel terminal panes. This screen is a **full-window route**,
not a dialog and not a pane — the user leaves the workspace to enter it, and returns with Esc.

The Council is Chorus reviewing its own design documents. The user points it at a Markdown
"brief" containing numbered questions; three to five AI models answer those questions blind,
critique each other anonymised, and a designated **arbiter** model rules on the disagreements
and writes a synthesis. The output is a Markdown findings file written beside the brief.

A run costs real money (currently ~$0.83) and takes ~14 minutes. **The screen's job is to make
a long, expensive, mostly-waiting process feel legible** — the user should always know which
phase is running, who has answered, who has not, and what it has cost so far.

## Non-negotiable design system

This screen must look like it was drawn at the same time as the rest of the app. Use these
exact values.

### Fonts

- **UI:** `Archivo` — weights 400, 500, 600, 700
- **Mono:** `JetBrains Mono` — weights 400, 500, 600, and 400 italic
  Mono is used for *machine facts*: identifiers, model names, counts, costs, timings, key
  hints, section eyebrows. Never for prose.

### The surface ladder (darkest → lightest)

| Value | Role |
|---|---|
| `#08090B` | outside the window / deepest well |
| `#0A0B0D` | titlebar and status bar |
| `#0B0D10` | left rail |
| `#0D0F12` | app background |
| `#0F1216` | inset chip / recessed field |
| `#101318` | rail item hover |
| `#12151A` | card |
| `#13171C` | selected rail item |
| `#151920` | card hover |
| `#1A2027` | badge / avatar tile |
| `#171C22` | dimmed badge (completed items) |

### Borders and dividers

`#15181C` (chrome edges) · `#1D232A` (inset chips) · `#222831` (dimmed) · `#232A32`
(status-bar separators, keycap borders) · `#262D35` (badge outline)

### Text ladder

| Value | Role |
|---|---|
| `#E6EAEE` | primary — titles, active item names |
| `#C7CFD8` | body |
| `#B9C2CC` | badge glyph text |
| `#9AA4AE` | secondary — inactive item names |
| `#8A94A0` | muted labels |
| `#7E8894` | tertiary / captions |
| `#68737F` | quietest — timings, costs, status-bar text |
| `#545E6A` | eyebrow labels (`PROJECTS`, `COUNCIL`) |

### Accents

- **Jade `#3BCFAE`** — the brand accent; links and the primary affirmative. Hover `#6FE0C6`.
  Selection is `rgba(59,207,174,.25)`.
- **Periwinkle `#7C8CF8`** — the active-project spine and card outlines
  (`rgba(124,140,248,.22)`, dimmed `rgba(124,140,248,.13)`).
- **Amber `#F59E0B`** with text tint `#F5B23C` — "needs you".
- **Green `#22C55E`** — running/healthy.
- **Red `#EF4444`** with text tint `#D96C66` — error. Close-button hover is `#C42B1C`.
- **Violet `#B08CC9`** and **sand `#C9A97F`** appear as secondary project spine colors.

### The four state markers — colorblind-safe, shape-encoded

**Shape carries the meaning; color only reinforces it.** Reuse these exactly:

- **Needs you** — a `7×7px` square rotated 45° (a diamond), fill `#F59E0B`, glow
  `0 0 8px rgba(245,158,11,.6)`. Its container also pulses: `chorusPulse 2.2s ease-in-out
  infinite`, animating `box-shadow` between `0 0 0 1px rgba(245,158,11,.45), 0 0 10px
  rgba(245,158,11,.08)` and `0 0 0 1px rgba(245,158,11,.95), 0 0 18px rgba(245,158,11,.30)`.
- **Running** — an `8×8px` circle, fill `#22C55E`, glow `0 0 8px rgba(34,197,94,.55)`.
- **Error** — an `11×10` SVG triangle, `path d="M5.5 0.5 10.5 9.5H0.5Z"`, fill `#EF4444`,
  `filter: drop-shadow(0 0 4px rgba(239,68,68,.6))`.
- **Done** — a `7×7px` square, unrotated, fill `#68737F`, no glow. Its card sits at
  `opacity: 0.82`.

**Reduced motion:** under `@media (prefers-reduced-motion: reduce)`, pulsing and blinking stop
and resolve to the bright end of the animation as a static shadow.

### Geometry and rhythm

- Radii: `3px` chips and keycaps · `5px` rail items · `6px` cards.
- Titlebar `36px` tall; status bar `30px`; left rail `208px` wide.
- Eyebrow labels: JetBrains Mono, `9.5px`, `letter-spacing: 0.18em`, color `#545E6A`, uppercase.
- Card padding `9px 11px`; rail item padding `9px 10px 9px 14px`.
- The active rail item carries a `2px` spine at its left edge, inset `8px` top and bottom,
  `border-radius: 1px`.
- Keycap hints (e.g. `esc`, `ctrl+k`): `9.5px` mono, `1px solid #232A32`, background `#111419`,
  radius `3px`, padding `1px 5px`.

## What this screen must contain

The screen has a **left roster rail** and a **main run surface**. Keep the app's existing
208px-rail proportions unless the content demands otherwise.

### Left rail — the council roster

Eyebrow `COUNCIL`. Then one card per configured member showing:

- the member's **label** (user-chosen, e.g. `CR Arbiter (opus-5)`) — primary text;
- its **role** — `member` or `arbiter`, small uppercase, muted. Exactly one arbiter exists;
- the **resolved model id** in mono (e.g. `anthropic/claude-opus-5`), truncated with ellipsis;
- **if the member cannot take part**, a red explanation line. ⚠ **An unavailable member must be
  shown and explained, never hidden** — the app refuses the entire run rather than silently
  dropping a member, and a roster that hid it would make that refusal unreadable.

During a run each member also needs a **live per-member state**: waiting, answering (streaming),
answered, or refused. Use the shape vocabulary above. This is the single most important
addition over the current implementation — during a 14-minute run the roster is what the user
watches.

At the bottom: a `back to workspace` control with an `esc` keycap. It is **disabled while a run
is in flight** (leaving mid-deliberation would strand a paid-for run with nowhere to render).

### Main surface

**Header.** Title `Council review` and one line of explanation: members answer the brief's
numbered questions blind, critique each other anonymised, and the arbiter rules and synthesizes;
findings land as a `-Findings.md` file beside the brief.

**Brief picker row.** A `Choose brief…` button (opens a native file dialog), the chosen file's
name beside it (full path on hover) or `no brief chosen`, and on the right the primary
**`Run council`** button — or **`Cancel run`** while running. `Run council` is disabled unless a
brief is chosen and the roster is valid (≥2 deliberators and exactly 1 arbiter).

**⚠ The redaction notice — reproduce this sentence verbatim, and design it as permanent
furniture rather than a dismissible tip:**

> Chorus redacts registered exact values on ingest and scans briefs for known credential shapes.
> It cannot redact values an agent derives, and it cannot recognize a secret it has no pattern for.

This wording is deliberately bounded and is not allowed to be softened or shortened. It must be
readable but not alarming — it is a standing statement of a limit, not a warning.

**Phase indicator.** The run moves through five phases and the user must always know which:
`Positions (blind)` → `Critique (anonymised)` → `Arbitration` → `Synthesis` → `Done`, with a
round number. **Design this properly** — it is the main progress affordance across a 14-minute
wait, and the current implementation renders it as a single line of grey text.

**Live deliberation transcript.** A stream of turns, each showing **who** (member label, or
`orchestrator`), **which phase**, **which round**, and the text — which arrives token by token
while the model writes. Several members stream **concurrently** during a blind round, so the
design must make interleaved authorship unambiguous. Long. Scrolls. Text is prose, not code.

**Findings section**, once the run completes:

- ⚠ **A standing caveat, placed ABOVE the synthesis, reproduced verbatim:**
  > These findings are model deliberation, not verified fact. Nothing here was compiled, run or
  > tested, and no member could see the repository.

  This is the most important element on the screen. A real council once produced confident,
  well-argued output containing four compile errors, because it had the brief and not the
  repository. Design it so a reader cannot skip past it — but it should read as *epistemic
  status*, not as an error.
- Where the file was written (a path), or the write error.
- **An accounting block. ⚠ Every number here must appear with its denominator** — this is a hard
  rule in the codebase, not a preference. Show: members answered *of* planned (plus how many
  refused at least once); turns answered *and* refused; how many turns reported usage *and* for
  how many it was absent; tokens in/out — or `not reported`; and cost — or `not reported by the
  provider` — always qualified by *how many turns that figure covers*. A cost with no
  denominator is exactly the defect the rule exists to prevent.
- The synthesized findings document itself — long-form Markdown-ish prose, tens of thousands of
  bytes, scrollable.

## States to draw

Please produce these, as separate frames or a stacked sequence:

1. **Empty** — no brief chosen, roster configured and healthy.
2. **No members configured** — the roster is empty; the screen must say so and point to Settings.
3. **Running, mid-deliberation** — the phase indicator active, several members streaming at once,
   one member already answered, the transcript filling. This is the state the user stares at.
4. **Partial run** — one member unavailable or refused, the run continuing on the remainder.
   ⚠ A partial run must *read* as partial.
5. **Complete** — caveat, path, accounting block, findings document.
6. **Error** — the run refused before starting (e.g. the brief contained something matching a
   known credential shape, so the run was refused rather than redacted).

## Constraints

- **Dark theme only.** Chorus has no light mode and is not getting one.
- **Desktop, 1440×900 root frame**, same as the other mocks. Assume a frameless window: this
  screen sits below a 36px custom titlebar and above a 30px status bar, both of which already
  exist — you may draw them for context but they are not yours to redesign.
- **Keyboard-first.** Esc returns to the workspace. Show keycap hints where a shortcut exists.
- **No new iconography language.** The existing mocks use tiny inline SVGs and geometric shapes,
  not an icon font — stay with that.
- **Nothing may imply the findings are verified.** No checkmarks, no "✓ passed", no green
  success chrome around the findings. The visual language for a completed run should be
  "finished", never "correct".

## What already exists, for reference

The current implementation is `src/renderer/src/views/CouncilView.vue` — a 273-line functional
but unstyled version using generic neutral greys. It has the correct *content* and the correct
*rules*; what it lacks is the design. Treat it as a content inventory, not as a layout to
preserve. In particular its transcript is a flat list of bordered boxes, its phase indicator is
one line of grey text, and its roster shows no live per-member state — all three are the parts
most worth redesigning.

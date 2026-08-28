# Implementation Spec 7a-1 — Vendor Marks

_Pairs with [`../Tasks/Task-7a-1.md`](../Tasks/Task-7a-1.md). Authored 2026-08-26 against `3c70e87`._

**Read the task doc first**, and [`Phase-7a-Overview.md`](../Tasks/Phase-7a-Overview.md) for the
phase's purity contract and shared gate numbers. **D184 is settled** (Matthew, 2026-08-26 — faithful
vendor marks, monochrome) and there is no gate to discharge. This document adds what a task doc
should not carry:
the probe that has to run before a line is written, the exact insertion points, the component's
shape and the reasoning behind it, the CSS ruling, and the runtime checks that decide whether it
worked.

Every `file:line` cited below was opened and checked on 2026-08-26 at `3c70e87`. **TypeScript and
template blocks are SKETCHES** — they are the shape and the reasoning, not text to paste unread.
**The path data in them is deliberately elided**, because §0 is where it comes from and a spec that
carried it would be the exact failure this spec exists to prevent.

---

## §0 — Probe before you build (do not skip)

Four things this spec rests on are unmeasured until you measure them, and **one of them cannot be
recovered after the fact**: where each mark came from. `CLAUDE.md` forbids trusting recall for CLI
syntax because *"CLI agent flags move fast"* — **logos move too, and they fail worse.** A wrong flag
errors out on the first run; **a wrong mark renders perfectly, passes every gate in this document,
and is confidently wrong about somebody else's identity in an app that launches their tool.**

### (1) The environment — the junction, first, before anything

```powershell
New-Item -ItemType Junction -Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" `
  -Target "C:\Projects\ContactEstablished\Chorus\node_modules" | Out-Null
# ⚠ ASSERT IT EXISTS BEFORE TRUSTING ANY GATE BELOW. Whichever form you use, a
#   junction that was not created surfaces as `'tsc' is not recognized`, which
#   reads as a broken toolchain rather than a missing directory.
if (-not (Test-Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules\.bin\tsc.cmd")) { throw 'junction missing — gates below would be a false green' }
npm run typecheck ; npx vitest run ; npm run grep:secrets
```

Expect **0** · **2941 / 2941 across 78 files with 1 uncollected** (F103 — see the task doc's fact 2)
· **clean, 6 patterns**. **Record what you actually get.** There is no `npm run lint` in this repo
and `npm run lint` prints *Missing script*; do not report a lint pass.

**⚠ THE JUNCTION IS REMOVED WITH `cmd /c rmdir` AT THE END, NEVER `rm -rf` OR `Remove-Item
-Recurse`** — those follow the link and delete the **main checkout's** `node_modules`.

### (2) The six marks — the fact the whole task rests on

**Fetch each vendor's mark from that vendor's own current source, today.** Save each file **verbatim,
unedited** under `_verify/7a-1/marks/<name>.svg`.

| Entry | Where to look — **verify, do not assume** |
|---|---|
| `claude` | Anthropic's own brand assets / `claude.ai`'s SVG favicon |
| `codex` | OpenAI's own brand assets / `openai.com`'s SVG favicon. **⚠ CHECK WHETHER CODEX HAS ITS OWN LOGOMARK NOW.** If it does, that is the mark — Chorus launches Codex, not OpenAI. If it does not, OpenAI's mark is the honest stand-in and the docblock must say which one you used and why |
| `grok` | xAI's own brand assets / `grok.com`'s SVG favicon |
| `kimi` | Moonshot AI's own brand assets / Kimi's SVG favicon |
| `opencode` | `opencode.ai`, or the project's own repository logo asset |
| `shell` | **Nobody's. Chorus draws this one** — see §1's shell note. It is not fetched and is not attributed to anyone |

**Rules, and each one has cost someone a session somewhere:**

- **⚠ PREFER AN SVG. NEVER TRACE A RASTER.** A PNG favicon cannot be reproduced faithfully by eye,
  and tracing one is drawing from memory with extra steps and a false sense of provenance. If the
  only asset you can reach is a raster, **that mark is unsourced** — see the stop rule below.
- **⚠ THE `d` STRINGS ARE COPIED, NOT RETYPED, NOT ROUNDED, NOT SIMPLIFIED.** This is what makes
  fidelity checkable: a reviewer greps a `d` from `AgentMark.vue` and finds it character for
  character in the saved file. The moment a digit is adjusted by eye, that check is gone and the only
  remaining evidence is your word.
- **⚠ RECORD FOUR THINGS PER MARK AND PASTE THE TABLE INTO THE REPORT:** the **URL**, the
  **retrieval date**, the source's own **`viewBox`**, and the mark's **bounding box** in that
  viewBox's units. The first two are the provenance; the last two are the arithmetic in §1.
- **⚠ ALL SIX OR NONE.** If a mark cannot be sourced, **stop and report before editing any call
  site**. A picker showing three real marks beside two letter-tiles is worse than five letter-tiles:
  it looks like a half-finished migration, which is exactly what it would be. The two letters are a
  perfectly serviceable fallback and reverting to them costs nothing; a wrong mark costs the
  argument that got D184 approved.
- **⚠ MULTI-PATH AND `fill-rule` ARE NOT DETAILS.** Several vendor marks are two or more paths, and
  several rely on `fill-rule="evenodd"` to punch a hole. **Drop the `fill-rule` and a ring becomes a
  disc** — the mark still renders, still looks deliberate, and is wrong. Copy every path and every
  `fill-rule` the source carries.
- **⚠ IF A SOURCE IS STROKE-BASED RATHER THAN FILLED, STOP AND REPORT.** All six entries are
  specified as solid shapes on `fill="currentColor"` with no stroke (§1), and flattening a stroked
  design to fills by eye is a redraw. Either the vendor publishes a filled variant — use it — or the
  case needs a decision, not an improvisation.

### (2b) The bounding boxes — a four-line harness, no CDP

`getBBox()` is the only honest way to know how much of its viewBox a mark actually occupies, and
several vendor files carry generous padding that would otherwise make one mark read small beside its
neighbours. Write `_verify/7a-1/bbox.html`, inline the six sources into it, and open it in **any**
browser — this is deliberately **not** a CDP job, because the app is not running yet and pointing the
drive's window at a local file would cost you the drive:

```html
<!-- _verify/7a-1/bbox.html — prints a copy-pasteable table. -->
<svg id="probe" width="0" height="0"><!-- one <g id="claude">…</g> per mark, paths pasted verbatim --></svg>
<pre id="out"></pre>
<script>
  const rows = [...document.querySelectorAll('#probe > g')].map((g) => {
    const b = g.getBBox()
    return `${g.id}\t${b.x}\t${b.y}\t${b.width}\t${b.height}`
  })
  document.getElementById('out').textContent = rows.join('\n')
</script>
```

**Paste the printed table into the report.** It is the input to §1's transform arithmetic, and it is
the thing a reviewer re-derives if a mark looks wrong.

### (3) The three maps are still where this spec says they are

```powershell
Get-ChildItem -Path src\renderer\src -Recurse -Include *.vue | Select-String -Pattern "const codes"
# expect exactly 3: LaunchDialog.vue:608, FilmstripRenderer.vue:100, TerminalPane.vue:80
Get-ChildItem -Path src\renderer\src -Recurse -Include *.vue,*.ts | Select-String -Pattern "const labels|AGENT_LABELS"
# expect 4 — and NONE of them is yours to touch
```

If the counts differ, the tree has moved under this document; **re-verify before editing rather than
adapting silently.**

### (4) The union has not widened yet

```powershell
Select-String -Path src\shared\ipc.ts -Pattern "agentKindSchema = z.enum"
# expect: z.enum(['claude', 'codex', 'grok', 'kimi', 'opencode'])  — FIVE, no 'shell'
```

If `'shell'` is already there, **7a-2 has landed ahead of this task** and §1's `AgentMarkName` alias
collapses to `AgentKind` — which is harmless, but say so rather than leaving a reader to wonder why
the alias exists.

---

## §1 — `src/renderer/src/components/AgentMark.vue` (new)

**Placement rationale:** beside `PaneIcon.vue`, in `components/`, because it is the same kind of
thing — a family of glyphs with one grid, one colour model and one docblock recording where each
shape came from. `PaneIcon.vue:14`–`:20` already argued that vendored geometry beats an installed
package here, and nothing about that argument is weaker for six marks that change less often than
Lucide does.

**⚠ ONE FILE, AND THE DATA STAYS IN IT.** Extracting `MARKS` to a plain `agentMarks.ts` (the shape
`projectRail.test.ts` and `projectChip.test.ts` use for testable renderer logic) was considered and
refused: the only properties worth asserting are already enforced by the compiler or by the
no-raw-hex grep (the task doc's *Test Expectations* argues this in full), and splitting the file
would separate the geometry from **the docblock that records where it came from** — which is the
artefact that actually protects fidelity. If a later task needs the marks outside a Vue component,
that is when the extraction earns its keep.

### The type — and why it is a `Record`, not a `v-else-if` chain

**⚠ ONE WORDING RECONCILIATION, SO IT IS NOT READ AS A CONTRADICTION.**
[`Phase-7a-Overview.md`](../Tasks/Phase-7a-Overview.md) describes this component as *"keyed off a
`Record<AgentKind, …>`"*. That is the property it is naming — **the compiler demands the next kind's
mark** — and it is exactly right. The literal type below is `Record<AgentMarkName, Mark>` with
`AgentMarkName = AgentKind | 'shell'`, **because `'shell'` is not in `AgentKind` until 7a-2 lands and
this task must ship its mark anyway**. When 7a-2 widens `agentKindSchema`, the union collapses and
the Overview's wording becomes literally true as well. Same guarantee, one task early.

```ts
import type { AgentKind } from '../../../shared/ipc'

/**
 * ⚠ `AgentKind | 'shell'` RATHER THAN `AgentKind`, AND ONLY UNTIL 7a-2 LANDS.
 * `'shell'` is not in `agentKindSchema` at 3c70e87 (shared/ipc.ts:902) — Task
 * 7a-2 widens it. The mark is drawn HERE anyway, deliberately: 7a-2 is a
 * main-process task about a schema widening and an adapter, and a DRAWING that
 * landed in that diff would have no reviewer looking at geometry. When 7a-2
 * lands, `AgentKind | 'shell'` collapses to `AgentKind` on its own — the union
 * is idempotent, nothing breaks, and this alias can be simplified in one line.
 */
export type AgentMarkName = AgentKind | 'shell'


interface MarkPath {
  /** ⚠ COPIED VERBATIM FROM THE SOURCE FILE. Never retyped, never rounded. */
  readonly d: string
  /** ⚠ ONLY WHEN THE SOURCE CARRIES IT. Dropping an `evenodd` turns a ring into
   *  a disc — the mark still renders and is still wrong. */
  readonly fillRule?: 'evenodd'
}

interface Mark {
  /** The 24-grid placement, DERIVED in §0(2b) and shown working in the comment
   *  beside each entry. `null` when the source is already a 24 box drawn
   *  edge-to-edge — rare, and worth saying so rather than writing `scale(1)`. */
  readonly transform: string | null
  readonly paths: readonly MarkPath[]
}
```

```ts
/**
 * ⚠ A `Record`, NOT A `<template v-else-if>` CHAIN, AND THIS IS THE ONE
 * STRUCTURAL DECISION IN THE FILE.
 *
 * `PaneIcon.vue` keys its glyphs off a chain (`:73` onward) and that is fine for
 * a closed set nothing else widens. `AgentKind` is NOT that set: D86 added
 * `kimi`, D90 added `opencode`, D165 added `grok`, and **Task 7a-2 adds
 * `shell`**. A template chain is NOT exhaustiveness-checked by `vue-tsc` — a
 * name with no matching branch renders an EMPTY `<svg>`, which is a 16px hole in
 * a badge tile. That reads as a CSS bug, sends the reader to the stylesheet, and
 * is the exact failure this shape exists to prevent.
 *
 * With a `Record<AgentMarkName, Mark>`, the next widening fails the TYPECHECK,
 * at the map, in the file that owns the drawing, before anything renders. That
 * is `notifications.ts:6`-`:10`'s argument verbatim: "D86 added 'kimi' and the
 * COMPILER found this file … That is the property working, not a chore."
 */
const MARKS: Record<AgentMarkName, Mark> = {
  // claude — <URL>, retrieved <date>. Source viewBox "0 0 W H", bbox x/y/w/h.
  // transform: scale s = 18 / max(bw, bh); translate centres the bbox on 24.
  claude: { transform: 'translate(… …) scale(…)', paths: [{ d: '…' }] },
  codex: { … },
  grok: { … },
  kimi: { … },
  opencode: { … },
  // shell — CHORUS'S OWN DRAWING, see below. Nobody's mark; no attribution.
  shell: { transform: null, paths: [{ d: '…' }, { d: '…' }] }
}
```

### The transform — how a vendor's box becomes the 24 grid

**⚠ THE PATHS ARE THE VENDOR'S AND THE PLACEMENT IS OURS, AND KEEPING THOSE TWO SEPARATE IS THE
WHOLE FIDELITY STRATEGY.** Given a source `viewBox="0 0 W H"` and a bbox `(bx, by, bw, bh)` measured
in §0(2b):

```
s  = TARGET / max(bw, bh)
tx = (24 - bw * s) / 2 - bx * s
ty = (24 - bh * s) / 2 - by * s
transform = `translate(${tx} ${ty}) scale(${s})`
```

`TARGET` is how many of the 24 units the mark's larger dimension occupies. **Start at 18 and then
look at it.** The number is optical, not arithmetic: `PaneIcon`'s glyphs span 12–20 units but they
are **stroked**, and a filled shape of the same extent reads considerably heavier. There is
precedent for admitting this in the codebase rather than pretending to a formula —
`TerminalPane.vue:1617` says of its header tint *"The value below was chosen by looking at it, not
by arithmetic."* **Record the final `TARGET` per mark in its comment**, and if one mark needed a
different one, say which and why.

**The alternative, named and refused: a per-mark `viewBox` on the `<svg>` root.** It is simpler —
paste the source's own viewBox and let the browser fit it — and it is wrong here, because it lets
**each vendor's own padding decide Chorus's optical size**. One mark drawn edge-to-edge beside one
with 15% margin would render at visibly different weights in the same row, and the 24 grid exists
precisely to remove that. The transform costs three numbers per mark, computed once, checkable by a
reviewer with the bbox table.

### The props

```ts
withDefaults(defineProps<{ name: AgentMarkName; size?: number }>(), { size: 11 })
```

**⚠ NO `strokeWidth` PROP, BECAUSE THERE IS NO STROKE.** `PaneIcon` has one and scales it with the
box (`:33`–`:37`); a filled mark has nothing to scale, so the prop would be a knob wired to nothing.

**⚠ THE DEFAULT IS 11, WHICH IS THE SMALLER OF THE TWO CALL-SITE SIZES, ON PURPOSE.** The tiles are
18×18 with a 1px border (a 16px content box) and 16×16 with a 1px border (14px). The picker passes
`:size="12"`, the two 16px tiles take the default. A forgotten prop therefore renders slightly small
rather than overflowing its tile — the recoverable direction, and the one a reviewer notices rather
than one that breaks layout.

### The template

```html
<template>
  <!-- ⚠ FILLED, WHERE PaneIcon IS STROKED, AND THE DIFFERENCE IS DELIBERATE.
       PaneIcon draws UI verbs — actions Chorus invented, cut to one hairline
       weight so the header row reads as one family. These are VENDOR MARKS: they
       are solid shapes in their own source and re-cutting them as outlines would
       be redrawing somebody else's logo, which is exactly what D184 forbids. So
       the two components deliberately do not share a root element, and neither
       should be "unified" into the other.

       ⚠ `currentColor` AND NOTHING ELSE. No hex, no gradient, no second tone.
       D38: "agent identity by glyph only, never color" — the tile's own `color`
       is what this resolves to, which is what makes the .card-done dim rule
       (FilmstripRenderer.vue:690) re-tint the mark for free.

       `aria-hidden` because every surface renders the agent's NAME as text
       beside the tile (LaunchDialog.vue:884, TerminalPane.vue:1404). The one
       surface that does not — the filmstrip card — carries a `title` on the
       tile instead; see §3. -->
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    aria-hidden="true"
    focusable="false"
  >
    <g :transform="MARKS[name].transform">
      <path v-for="(p, i) in MARKS[name].paths" :key="i" :d="p.d" :fill-rule="p.fillRule" />
    </g>
  </svg>
</template>
```

**⚠ `MARKS[name]` NEEDS NO GUARD AND MUST NOT BE GIVEN ONE.** `name` is `AgentMarkName` and `MARKS`
is a total `Record` over it, so the lookup cannot miss. A `?.` or an `|| FALLBACK` here would be
worse than useless: it would compile away the very error the `Record` exists to raise, and the
missing mark would come back as an empty `<svg>` — the failure mode of the chain this shape
replaced. Vue omits an attribute bound to `null`/`undefined`, so `transform: null` and an absent
`fillRule` both render as no attribute, with no branch.

### The docblock

Model it on `PaneIcon.vue:2`–`:38`, which is the reason that file is still trustworthy a phase later.
It must carry:

1. **WHY THIS EXISTS** — `cc` / `cx` / `gk` / `km` / `oc` were codes standing in for icons: they have
   to be learned, they do not survive peripheral vision, and at 8.5px they are near the limit of
   legibility.
2. **THE PROVENANCE TABLE** — per mark: source URL, retrieval date, the source's `viewBox`, the
   measured bbox, the `TARGET` used. **⚠ This is the part that cannot be reconstructed later**, and
   it is what a future implementer needs when a vendor restyles.
3. **D184 IN TWO SENTENCES, WITH THE OVERRIDE NAMED** — the icon channel is already the agent's
   (`PLAN.md:185`, D38); hue stays the project's; what is overridden is the **mock**
   (`docs/design/v2/Chorus Launch Dialog.dc.html:64`), which D73 makes the authority, and the
   precedent is `ChorusMark.vue:15`–`:22`.
4. **THE NOMINATIVE-USE NOTE, ONCE** — these marks identify the tool a button launches, the same use
   an IDE makes of them; monochrome and faithful; Chorus's own branding is never restyled to
   resemble any of them.
5. **WHY FILLED WHERE `PaneIcon` IS STROKED**, and **why a `Record` where `PaneIcon` uses a chain** —
   both stated as deliberate divergences so nobody "harmonises" them later.

### The `shell` mark — Chorus's own

A `>_` prompt: a chevron and a caret bar, both **filled**, on the same 24 grid.

**⚠ NOT LUCIDE'S `terminal`.** That glyph is stroked, and dropping a stroked glyph into a filled
family reintroduces the inconsistency `PaneIcon.vue:5`–`:12` was created to remove — *"six different
KINDS of thing … They shared no grid, no stroke weight, no optical size and no colour model."* A
`>` drawn as a stroked polyline beside five solid vendor marks would read as the odd one out at
exactly the size where that matters most.

Draw it as two filled shapes: a chevron (a closed path — two strokes' worth of thickness given as
geometry, not as `stroke-width`) and a rounded bar for the caret. **The sketch below is a starting
point, not a specification** — it is Chorus's own drawing, so the only authority is what it looks
like at 11px beside the other five, and §9's optical check is where that is decided.

```
  chevron:  a filled arrowhead occupying roughly x 4→12, y 6→18
  caret:    a filled rounded bar occupying roughly x 13→20, y 16→18
```

**⚠ Nothing renders this entry until 7a-2 widens `agentKindSchema`.** That cost is stated in the
task doc's *Goal* and is accepted: one task's worth of typed, required, unrendered code, bought so
that the drawing lands where a reviewer is looking at drawings.

---

## §2 — `src/renderer/src/components/LaunchDialog.vue`

### Delete `:599`–`:614`

The whole `codes` block, docblock included. **⚠ Read that docblock before deleting it and carry its
one durable sentence into `AgentMark.vue`'s**: *"D38's system vocabulary is 'agent identity by glyph
only, never colour', and this is that glyph, keyed by the closed AgentKind union so a new adapter
fails the typecheck rather than rendering blank."* **Both halves of that sentence survive this task
verbatim in spirit** — the glyph is still monochrome, and it is still keyed by a closed union
precisely so a new adapter fails the typecheck. Deleting the comment without re-homing the reasoning
is how a rule quietly stops being written down anywhere.

**⚠ WHAT MUST NOT GO WITH IT.** `HIDDEN_AGENTS` (`:512`) and its docblock (`:505`–`:511`),
`toAgentCards` (`:514`–`:523`), and the `label: c.displayName ?? c.agentKind` read at `:520` are all
untouched. `LaunchDialog` hardcodes **no** agent label, on purpose, since 3-3/D34f — do not "make it
consistent" with the two files that do.

### The import

Beside the existing component imports at the top of `<script setup>`:

```ts
import AgentMark from './AgentMark.vue'
```

### `:882` — the tile's content

```html
            <span class="launch-agent-tile"><AgentMark :name="a.name" :size="12" /></span>
```

`a.name` is `AgentKind` (`:53`, `:519`), which is assignable to `AgentMarkName` with no cast — one of
the reasons the alias is a **union** rather than a separate enum. The surrounding `<button
class="overlay-card launch-agent">` (`:877`) is unchanged, so selection (`overlay-card-selected`,
`:878`) and the disabled state (`overlays.css:180`–`:185`, `opacity: 0.55`) keep working **on the
mark for free** — the card fades whole, glyph included, because opacity applies to the subtree.

### `.launch-agent-tile` (`:1378`–`:1391`)

Keep: `width: 18px`, `height: 18px`, `flex: none`, the flex centring, `border-radius:
var(--radius-chip)`, `background: var(--color-surface-badge)`, `border: 1px solid
var(--color-border-badge)`.

**Remove:** `font-family: var(--font-mono)` and `font-size: 9px`. Nothing in this tile is text any
more.

**⚠ KEEP `color: var(--color-text-badge)`, AND COMMENT IT — THIS IS THE ONE LINE IN THE CSS DIFF
WHOSE MEANING CHANGED RATHER THAN WHOSE VALUE DID:**

```css
  /* ⚠ NOT TEXT STYLING ANY MORE — THIS IS THE MARK'S TINT. `AgentMark` fills
     with `currentColor`, so this declaration is the only thing deciding what
     colour the glyph is. Delete it as "dead text styling" and the mark silently
     inherits from whatever is above, and the whole family shifts tone with no
     gate to catch it. */
  color: var(--color-text-badge);
```

**The mock's tile is still the mock's tile.** `docs/design/v2/Chorus Launch Dialog.dc.html:64`
inline-styles `18px / radius 3px / #1A2027 / 1px #262D35 / #B9C2CC`, and every one of those five
values survives this edit as the token it was already written as. **That is the evidence that the
D184 override is narrow: the chrome D73 governs is untouched and only the glyph inside changed.**

---

## §3 — `src/renderer/src/components/FilmstripRenderer.vue`

**⚠ THIS IS THE CALL SITE WITH THE TWO COMPLICATIONS. Do it third in reading order and first in
care.**

### Delete `:96`–`:106`

The `codes` map and its docblock. **⚠ Its docblock is the one that must be re-homed, not discarded**
— it states the reason this tile exists at all:

> *"It is what keeps F12b true now that the full agent label no longer fits the card: same-project
> Codex titles collide (they are cwd basenames), so the title alone never identifies a card — the
> tile plus the title compose the identity."*

**That sentence is why this call site gets a `title` attribute below**, and it must be quoted in the
comment that replaces it.

**`labels` at `:88`–`:94` stays** — and stops being merely adjacent, because this task makes it a
live dependency of the tile.

### `:370` — the tile

Today:

```html
          <span class="card-tile">{{ agentFor(id) ? codes[agentFor(id) as AgentKind] : '??' }}</span>
```

After:

```html
          <!-- ⚠ THE `'??'` FALLBACK IS REAL AND STAYS AS TEXT. `agentFor` is
               `(id: string) => AgentKind | undefined` (:71), so this is the ONE
               call site that can be handed `undefined` — and `AgentMark` must
               never be, because a Record lookup on `undefined` renders an empty
               `<svg>`, i.e. a 16px hole that reads as a CSS bug.

               ⚠ AND THE `title` IS NEW, DELIBERATELY. The retired `codes`
               docblock recorded why: same-project Codex titles collide (they are
               cwd basenames), so "the tile plus the title compose the identity"
               — and this is the only surface where the tile is the agent's ONLY
               identifier, with no label text beside it. A two-letter code at
               least spelled something; a mark does not, so the name it stands
               for is put one hover away. The label comes from `labels` (:88),
               which is why that map is a dependency of this line and not just a
               neighbour. -->
          <span
            class="card-tile"
            :title="agentFor(id) ? labels[agentFor(id) as AgentKind] : undefined"
          >
            <AgentMark v-if="agentFor(id)" :name="(agentFor(id) as AgentKind)" />
            <template v-else>??</template>
          </span>
```

**On the repeated `agentFor(id)` calls:** the line already called it twice before this edit, so this
is the file's existing idiom rather than a new cost, and `agentFor` is a prop-supplied lookup over a
small array. A `computed` keyed by id would be tidier and is **out of scope** — it changes a
rendering pattern this task has no reason to touch. If a reviewer wants it, that is a separate,
deliberate change.

**On `aria-hidden` vs the `title`:** the mark stays `aria-hidden` (§1). `title` is a hover
affordance for a sighted user who cannot read a glyph they do not recognise yet; it is not an
accessible name, and this task does not add one — the card's accessible content is its title text,
exactly as before.

### `.card-tile` (`:535`–`:548`)

**⚠ THIS RULE IS THE EXCEPTION AND THE ASYMMETRY IS DELIBERATE.** `.launch-agent-tile` and
`.pane-tile` lose their text declarations because nothing in them can ever be text again.
**`.card-tile` KEEPS `font-family: var(--font-mono)` and `font-size: 8.5px`, because the `'??'`
fallback above is still text** — strip them and that fallback renders at the inherited 12px inside a
16px box. Add the one-line reason in the rule so the next reader does not "finish the job":

```css
  /* ⚠ THE TEXT PROPERTIES STAY HERE AND ONLY HERE. This is the one tile that can
     still contain text — the `'??'` fallback for a session row with no agent.
     The picker's and the pane header's tiles lost theirs. */
```

**`color: var(--color-text-badge)` stays, with the same tint comment as §2.**

### `.card-done .card-tile` (`:690`–`:694`) — do not touch it

It already sets `color: var(--color-text-muted)` for the completed state, **so it dims the mark for
free.** That is not a happy accident, it is the proof that `currentColor` is wired to the tile rather
than to something above it — and §9's runtime step (c) is where a reviewer sees it working. **Adding
any rule here would break the demonstration as well as being redundant.**

---

## §4 — `src/renderer/src/components/TerminalPane.vue`

### Delete `:79`–`:86`

The `codes` map and its one-line docblock (*"The design's two-letter agent tile, same codes the
filmstrip card uses"* — which is itself the evidence that three identical copies existed).

**`labels` at `:71`–`:77` stays** and is already live at `:1404`, where the header renders
`` `${labels[props.agent]} - ${sessionName}` ``.

**⚠ AND THE OTHER `Record<AgentKind, …>` IN THIS FILE IS NOT YOURS.** The column-1 authorship glyph
map documented from `:88` onward — *"EVERY ENTRY IS MEASURED FROM A REAL PTY CAPTURE, NEVER
GUESSED"* — is a terminal-rendering fact, not a UI icon, and it is untouched. It is worth reading
before you start, though: it is the same D4 discipline this task applies to logos, written by
someone who had already been bitten by it.

### The import

Beside `import PaneIcon from './PaneIcon.vue'` at `:10`:

```ts
import AgentMark from './AgentMark.vue'
```

The two sit together on purpose — a reader meeting one should meet the other, and the docblock
divergence (filled/`Record` vs stroked/chain) is easier to notice when the imports are adjacent.

### `:1399` — the tile

```html
        <span class="pane-tile"><AgentMark :name="props.agent" /></span>
```

`props.agent` is `AgentKind`, assignable with no cast, and this call site **cannot** be `undefined` —
a pane always has an agent. The `'??'` complication is the filmstrip's alone.

Everything after it on the meta row is unchanged: the agent-plus-name segment at `:1403`–`:1405`,
the note, the branch glyph, the spacer.

### `.pane-tile` (`:1926`–`:1939`)

Keep the box and **keep `color: var(--color-text-badge)` with the tint comment**. **Remove
`font-size: 8.5px` and `letter-spacing: 0.05em`** — nothing here is text again. Note this rule
declares no `font-family`; it inherited `--font-mono` from `.pane-meta` (`:1834`), which is another
reason the mono declaration was never load-bearing here.

### The header's focus states — nothing to do, and say so in the report

`.pane-shell:focus-within .pane-header` (`:1622`–`:1624`) changes **`background-color` only**.
**⚠ So the mark's colour is identical focused and unfocused, and it always was** — the two letters
behaved exactly the same way. §9's step (c) confirms the tint *does* change on the one state that
changes `color` (`.card-done`), which is the informative half of the same check. **Do not "fix" the
focused header to tint its tile**; that would put agent identity on a state channel, which is D38's
third channel and not the agent's.

---

## §9 — Verification

### Build

```powershell
# ⚠ FIRST. A worktree has no node_modules and every gate below is a false green without this.
New-Item -ItemType Junction -Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" `
  -Target "C:\Projects\ContactEstablished\Chorus\node_modules" | Out-Null
# ⚠ ASSERT IT EXISTS BEFORE TRUSTING ANY GATE BELOW. Whichever form you use, a
#   junction that was not created surfaces as `'tsc' is not recognized`, which
#   reads as a broken toolchain rather than a missing directory.
if (-not (Test-Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules\.bin\tsc.cmd")) { throw 'junction missing — gates below would be a false green' }

npm run typecheck        # 0, node + web
npx vitest run           # 2941 / 78 + 1 uncollected in a worktree (F103); 2969 / 79 in the main checkout
npm run grep:secrets     # clean, 6 patterns
```

**⚠ `npm run typecheck` IS THE REAL ORPHAN-REFERENCE CHECK, AND IT IS THE ONLY AUTOMATED THING THIS
TASK CAN FAIL.** Each `codes` map is read by exactly one template expression; delete the map and
leave the reader and `vue-tsc` fails. **A green typecheck after all three deletions is the proof the
swap was complete** — reading the diff is the weaker check, and the count of files changed proves
nothing about whether a reference survived.

**⚠ The test total must not move.** This task adds no test (the task doc's *Test Expectations*
argues why at length). **A changed count in a task that adds no test is a finding, not a rounding
difference.**

### Structural

```powershell
# The maps are gone — both greps empty.
Get-ChildItem -Path src\renderer\src -Recurse -Include *.vue,*.ts | Select-String -Pattern "const codes"
Get-ChildItem -Path src\renderer\src -Recurse -Include *.vue,*.ts | Select-String -Pattern "codes\["

# The labels maps survived — still 4.
Get-ChildItem -Path src\renderer\src,src\main -Recurse -Include *.vue,*.ts | Select-String -Pattern "const labels|AGENT_LABELS"

# NO COLOUR, in any of the four files. A hard gate: D184 rests on it.
Select-String -Path src\renderer\src\components\AgentMark.vue,src\renderer\src\components\LaunchDialog.vue,src\renderer\src\components\FilmstripRenderer.vue,src\renderer\src\components\TerminalPane.vue `
  -Pattern '#[0-9a-fA-F]{6}\b'      # expect NOTHING
# ⚠ `grep` IS NOT ON PATH IN POWERSHELL HERE — verified 2026-08-26, `Get-Command grep` returns
#   nothing. Use Select-String. This form was proven BOTH ways before being written down:
#   ActivityBar.vue (the one file allowed raw hex) returns 12 hits, and PaneIcon.vue +
#   TitleBar.vue (both asserted hex-free) return 0. A gate only ever tested against a clean
#   file cannot tell "passing" from "not running".
# and the near-misses a hex grep does not catch:
Select-String -Path src\renderer\src\components\AgentMark.vue -Pattern "rgb\(|hsl\(|color-mix|gradient|opacity"
Select-String -Path src\renderer\src\components\AgentMark.vue -Pattern 'fill="' # expect ONE hit: fill="currentColor"

# Six entries, and the compiler already guarantees it — this is the human-readable confirmation.
Select-String -Path src\renderer\src\components\AgentMark.vue -Pattern "^\s+(claude|codex|grok|kimi|opencode|shell):"

# The tint survived on all three tile rules.
Select-String -Path src\renderer\src\components\LaunchDialog.vue,src\renderer\src\components\FilmstripRenderer.vue,src\renderer\src\components\TerminalPane.vue `
  -Pattern "color: var\(--color-text-badge\)"       # expect 3

# Nothing left the renderer, and nothing was absorbed.
git diff --stat          # exactly 4 paths under src/renderer/src/components/
git status --porcelain   # `M .mcp.json` and `M docs/.../roadmap.md` still there, still unstaged
Select-String -Path package.json -Pattern "lucide|iconify|test-utils|jsdom|happy-dom"   # expect NOTHING
```

**Fidelity — the check that separates a copied mark from a drawn one.** For each of the five vendor
entries, take the `d` string out of `AgentMark.vue` and find it, character for character, in the
file saved under `_verify/7a-1/marks/`:

```powershell
Select-String -Path _verify\7a-1\marks\<name>.svg -SimpleMatch "<the d string from AgentMark.vue>"
# expect a hit, for every path of every vendor mark. `shell` is exempt: it is Chorus's own drawing.
```

**⚠ A MISS HERE MEANS THE PATH WAS TRACED OR ADJUSTED, WHICH IS DRAWING FROM MEMORY WITH A CITATION
ATTACHED.** It is the single most likely way this task ships something wrong while looking right.

### Runtime — the only coverage this task has

**⚠ THERE ARE NO `.vue` TESTS IN THIS REPO AND THIS TASK ADDS NONE** (79 test files, none mounting a
component; `vitest.config.ts:11` is `environment: 'node'`; no `@vue/test-utils`, no `jsdom`). **So
the drive is not the last step, it is the test.** Evidence under `_verify/7a-1/`.

1. **Seed a scratch user-data dir** from the installed app so the window has real projects and real
   sessions: copy `%APPDATA%\chorus-app\chorus.db` (plus `-wal` / `-shm` when present) **and
   `Local State`** beside it — without the last one every pre-existing credential blob is
   undecryptable and the dialog paints wrong for reasons unrelated to this task.
2. `npm run dev` against that dir with `--remote-debugging-port=9333`. **⚠ 9333, NEVER 9222** — 9222
   is the installed stable Chorus, and driving it would be driving the wrong app.
3. **(a) The picker.** Open the launch dialog and screenshot the agent grid. **Four cards, not
   five** — `kimi` is filtered by `HIDDEN_AGENTS` (`LaunchDialog.vue:512`), and a report claiming
   five has driven something other than this build. Each card shows its mark. Then confirm two
   states without adding CSS: a **not-found** agent's card fades whole, mark included
   (`overlays.css:183`, `opacity: 0.55`); a **selected** card changes border and background and
   leaves the glyph alone (`:174`–`:178`).
4. **(b) Both pane-header modes, in one drive.** Grid: each pane's `.pane-meta` shows its mark beside
   the label. Filmstrip: each card's `.card-tile` shows its mark. **Both** — they are two different
   components with two different tile rules, and only one of them has the `'??'` branch. A CDP read
   is enough evidence for the second if the screenshot covers the first:

   ```js
   document.querySelectorAll('.card-tile svg, .pane-tile svg').length
   ```
5. **(c) The states that prove `currentColor` is wired to the tile.** Focus and unfocus a pane: the
   header tints its **background** and the mark's colour does **not** change — correct, expected, and
   true of the two letters before it. Then find or make a **completed** card: `.card-done .card-tile`
   sets `color: var(--color-text-muted)` (`FilmstripRenderer.vue:690`–`:694`) and **the mark must dim
   with it, with no CSS added by this task.** That single observation is the behavioural proof that
   the tint comes from the tile's `color` and not from something above it — i.e. it is the test for
   the task doc's fact 7.
6. **(d) Kimi — the entry the picker can never show.** A kimi mark must render in a **pane header**.
   Check the seed first:

   ```sql
   SELECT id, agent, created_at FROM sessions WHERE agent = 'kimi' ORDER BY created_at DESC LIMIT 3;
   ```

   If a row exists, drive it and screenshot the header. **If none exists, say so and report the
   visual half of this check as NOT PERFORMED**, resting on the `Record`'s compile-time guarantee for
   the rest. **Do not fabricate a pane and do not claim the observation** — the failure-honesty
   clause covers this case explicitly, and an unverifiable claim here is worse than a gap, because
   kimi is precisely the entry nobody will look at again.
7. **(e) The optical check, which IS the deliverable.** Screenshot all six marks at their rendered
   sizes — 12px in the 18px tile, 11px in the 16px tiles — **at 100% zoom, unscaled**, and look at
   them. Every mark must be recognisable as its vendor's, and no mark may be visibly heavier or
   lighter than its neighbours. **If one is, the fix is that mark's `TARGET` and transform, never the
   tile's geometry** — the box is the mock's and is not this task's to adjust. An enlarged screenshot
   proves nothing about a glyph whose entire problem was that it is eleven pixels tall.
8. **Remove the junction — with `rmdir`, not `rm -rf`:**

   ```powershell
   cmd /c rmdir "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules"
   ```

**⚠ Failure-honesty clause.** Any command or step that fails — a vendor site unreachable, CDP
refusing the port, no kimi row, a missing CLI — is reported **with its output**, and the step is
**not claimed**. Environmental failure is a legitimate result; a silently skipped step is not. For
this task the stakes are unusually plain: **the drive is the only test, so an unreported gap in it is
an unverified feature described as a finished one.**

### The invariants a reviewer should test hardest

**Three, and the first one is unrecoverable while the other two are merely expensive.**

1. **EVERY MARK CAME FROM ITS VENDOR, THIS SESSION, AND THE PATHS PROVE IT.** Do not accept this from
   a summary and do not accept it from the docblock alone — **check a `d` string against the saved
   source file**. A mark drawn from memory is indistinguishable from a mark drawn from the source in
   every way this repo can measure: it renders, it type-checks, it passes the hex grep, it looks
   deliberate. The verbatim-path rule exists solely so that this one property becomes checkable by
   `grep` instead of by trust. **If the paths are not verbatim, the marks were traced, and traced is
   memory with a citation attached** — send it back rather than eyeballing the result, because
   eyeballing is the failure mode, not the check. **Then check the provenance table has a URL and a
   date per mark**, because that is what the next person needs when a vendor restyles, and it cannot
   be reconstructed later by anyone.

2. **THE DATA IS A `Record`, NOT A `v-else-if` CHAIN, AND IT IS TOTAL.** Open `AgentMark.vue` and
   confirm `MARKS: Record<AgentMarkName, Mark>` with `AgentMarkName = AgentKind | 'shell'`, six
   entries, and **no `?.`, no `??`, no fallback branch at the lookup**. Every one of those would be
   an improvement that deletes the guarantee: the point of the `Record` is that **Task 7a-2's
   widening of `agentKindSchema` fails the typecheck at the map**, in the file that owns the
   drawing, before anything renders. A chain compiles, renders, passes every check in this document,
   and then quietly draws an empty 16px tile the day the union grows — and an empty tile reads as a
   CSS bug, which sends the next reader to the stylesheet for however long it takes them to think of
   the template. **This is the task's only automated regression guarantee; treat its removal as a
   scope change, not a simplification.**

3. **THE COLOUR MODEL IS INTACT AT BOTH ENDS — `currentColor` IN THE MARK, `color` ON THE TILE.**
   These are two halves of one mechanism and each fails silently without the other. Grep
   `AgentMark.vue` for `rgb(`, `hsl(`, `color-mix`, `gradient`, a hex, an `opacity`, or any `fill`
   other than `currentColor` — **a two-tone mark retires the D38 argument that approved this task**,
   and it will look fine, because vendor marks are usually two-tone and the "correct" version is the
   tempting one. Then check the other end: **`color: var(--color-text-badge)` must still be on all
   three tile rules**, each with the comment saying it is now the tint. It is the only line in the
   CSS diff whose *meaning* changed rather than its value, it looks exactly like dead text styling
   beside the `font-family` that genuinely is dead, and deleting it is invisible in review and
   invisible at runtime until someone notices the family is the wrong grey. **The behavioural proof
   is drive step (c)**: `.card-done` re-tints the mark for free, with no CSS added — if it does not,
   the tint is coming from somewhere other than the tile and the mechanism is wrong even though the
   screenshot looks right.

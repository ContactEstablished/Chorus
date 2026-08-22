<script setup lang="ts">
/**
 * PaneIcon — the pane header's icon family.
 *
 * WHY THIS EXISTS. Before it, the header's six controls were six different
 * KINDS of thing: a colour emoji (🎙), two Unicode arrows (⬌ ⬍), one inline
 * SVG at 1.2px stroke, the bare word "Kill", and a Unicode ✕. They shared no
 * grid, no stroke weight, no optical size and no colour model — the emoji
 * ignored `currentColor` entirely and stayed full-colour in every theme. That
 * is the real reason the row read as unrecognisable clutter; the 13px size was
 * only half of it. One component, one grid, one stroke weight fixes the half
 * that enlarging cannot.
 *
 * WHERE THE SHAPES COME FROM. The geometry is Lucide's (ISC, freely
 * vendorable) — `mic`, `rotate-cw`, `power`, `x`, `lock`, `lock-open` — copied
 * in rather than installed. Two reasons: CLAUDE.md locks the stack and asks
 * before new dependencies, and Lucide's 24-unit grid with round caps is
 * already the idiom of the hand-drawn glyphs in this header (the worktree
 * fork, the mock's restart arc), so vendoring six paths buys consistency
 * without buying a package whose upgrades could restyle the app chrome.
 *
 * `new-agent` is NOT Lucide's — see its own note below. It inherits the panel
 * outline the two retired split glyphs (`split-side` / `split-below`) drew, and
 * that inheritance is deliberate: D174 collapsed those two buttons into one, so
 * the family keeps the shape a reader already associates with "a pane appears"
 * and changes only what it says about WHERE.
 *
 * ⚠ EVERY GLYPH TINTS WITH `currentColor` AND NOTHING ELSE. No hard-coded hex,
 * no fill that survives a theme switch. The button owns the colour; this owns
 * the shape. That is what the emoji could not do, and it is the constraint
 * that keeps a future light theme from needing a second icon set.
 *
 * ⚠ STROKE WEIGHT IS EXPRESSED ON THE 24 GRID, NOT IN PIXELS. At the default
 * 16px render, 1.85/24 lands at ~1.23px on screen — deliberately alongside the
 * 1.15–1.2px hairlines already in the header rather than heavier than them.
 * Change `size` and the optical weight tracks it automatically; that is the
 * whole point of scaling the stroke with the box instead of pinning it.
 */

export type PaneIconName =
  | 'mic'
  | 'stop'
  | 'new-agent'
  | 'maximize'
  | 'minimize'
  | 'restart'
  | 'kill'
  | 'close'
  | 'lock'
  | 'lock-open'

withDefaults(
  defineProps<{ name: PaneIconName; size?: number; strokeWidth?: number }>(),
  { size: 16, strokeWidth: 1.85 },
)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <!-- mic (Lucide). Replaces the 🎙 emoji, which rendered as OS colour art at
         a size the OS chose and ignored the button's colour and hover state. -->
    <template v-if="name === 'mic'">
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </template>

    <!-- stop: the ONLY filled glyph in the set, and filled on purpose. It shows
         while dictation is live, where "solid block" is the universally read
         stop mark and the weight is what makes the active state obvious at a
         glance. It is a rounded square, not a circle — kill's `power` ring is
         the round one, and two round actives in one row would blur together. -->
    <template v-else-if="name === 'stop'">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
    </template>

    <!-- new-agent: the same panel outline the two split glyphs drew, now with a
         centred plus instead of a filled half. Hand-drawn, not Lucide — its
         `square-plus` is a bare rounded square, which loses the one thing this
         row's icons all say, that the subject is a PANE.

         ⚠ THE OLD NOTE HERE ARGUED A `+` COULD NOT SURVIVE 16px, AND IT WAS
         RIGHT ABOUT THE DRAWING IT WAS DESCRIBING: a plus crammed into HALF the
         panel, at ~6 units square, smudged. This one owns the whole box — 6
         units of stroke through a centre the outline no longer competes with —
         and reads at 16px for the same reason `close` does. What made the
         earlier attempt fail was the half, not the plus.

         D174 is why there is one glyph here instead of two: a new agent lands at
         the end of the flow and the grid wraps by window width, so there is no
         half to point at any more. An icon that promised a side would be lying. -->
    <template v-else-if="name === 'new-agent'">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M12 9v6" />
      <path d="M9 12h6" />
    </template>

    <!-- maximize / minimize (Lucide `maximize-2` / `minimize-2`): the pane's own
         view-mode toggle — out to the filmstrip with this agent full-size, back
         in to the grid.

         ⚠ DIAGONAL ARROWS, AND HERE THEY ARE HONEST. The header's history note
         above records ⬌/⬍ being thrown out for being RESIZE arrows on buttons
         that did not resize. This button does exactly that: the pane grows to
         fill the workspace and shrinks back to its cell. Same reasoning,
         opposite verdict, and the pair is the one convention every window
         manager already teaches.

         The two are mirror images, so the DIRECTION is the whole signal — which
         is why they are never both on screen at once: a pane draws one or the
         other according to the mode it is in. -->
    <template v-else-if="name === 'maximize'">
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
    </template>

    <template v-else-if="name === 'minimize'">
      <path d="M4 14h6v6" />
      <path d="M20 10h-6V4" />
      <path d="m14 10 7-7" />
      <path d="m3 21 7-7" />
    </template>

    <!-- restart (Lucide `rotate-cw`). The mock's own restart arc, re-cut on the
         24 grid so it shares this family's cap and weight instead of being the
         one glyph drawn to a 14-unit box. Same reading, same direction. -->
    <template v-else-if="name === 'restart'">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </template>

    <!-- kill (Lucide `power`).
         ⚠ THIS RESOLVES THE OBJECTION THAT KEPT KILL AS THE WORD "Kill". The
         header's note said an invented kill icon "would sit beside Close's ✕ as
         a second X — losing a distinction the header has today", and against a
         second ✕ that was right. A power ring is not an X: broken circle with a
         stem versus two crossed strokes, distinguishable at 16px, in grayscale,
         and by shape alone. The distinction is kept, and the row stops being
         five icons with one word wedged into it. The verb still reaches screen
         readers — the button carries `aria-label`, not just `title`. -->
    <template v-else-if="name === 'kill'">
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </template>

    <!-- close (Lucide `x`) — the mock's ✕, on the grid. -->
    <template v-else-if="name === 'close'">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </template>

    <!-- lock / lock-open (Lucide).
         ⚠ THE CLOSED-VS-OPEN SHACKLE IS LOAD-BEARING AND IS PRESERVED EXACTLY.
         The lock button's contract is that SHAPE carries the state and amber
         only reinforces it, so it stays readable without colour vision. Lucide
         draws that same distinction — `lock` closes the shackle onto the body,
         `lock-open` leaves it hinged and open on the left — so this is the
         previous hand-drawn pair re-cut to the family, not a new signal. -->
    <template v-else-if="name === 'lock'">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </template>

    <template v-else-if="name === 'lock-open'">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </template>
  </svg>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ViewMode } from '../../../shared/ipc'
import { chipColorValue } from '../projectChip'
import { useProjectStore } from '../stores/project'

/**
 * The project rail (Task 3c-3), which REPLACES the deleted project tab bar —
 * the design has a left rail, not a top tab bar.
 *
 * ⚠ THE BEHAVIOUR CONTRACT IS UNCHANGED AND IS THE WHOLE POINT: `store.projects`,
 * `store.activeId`, `store.select(id)`, `store.add()`. A rail written as a
 * `v-for` over projects and nothing else silently drops `add()`, and THE APP HAS
 * NO OTHER ROUTE TO ADDING A PROJECT — hence the bottom row below, which the
 * mock does not draw and which this file exists to keep.
 *
 * Geometry and colour are read from the `<!-- left rail: projects -->` block of
 * docs/design/v2/Chorus Workspace.dc.html (D73). Every value is a 3c-1 token;
 * this file contains no raw hex.
 *
 * ⚠ TWO THINGS THE MOCK DRAWS HERE ARE DELIBERATELY ABSENT:
 *  - the per-project cost the mock prints after the session count — D76:
 *    `attribution:summary` is account-scoped and windowed (F35), so there is no
 *    per-project figure. The session count ships; the cost is omitted rather
 *    than faked.
 *  - the attention badge (`◆ 2`) — D78: the renderer cannot know an agent is
 *    blocked on a human. Phase 4 owns that capability and its badge.
 *
 * ─── CHANGED: per-project identity + a collapsible rail ────────────────────
 *
 * Three things moved here, all of them Matthew's call:
 *
 *  1. THE SPINE IS NOW A CHIP, AND IT IS THE PROJECT'S OWN COLOUR IN BOTH
 *     STATES. It used to be 2px × full-height, and — the part that mattered —
 *     it turned PERIWINKLE when active, discarding the project's colour at
 *     exactly the moment you were looking at it. Now the colour is constant and
 *     the STATE is carried by brightness and glow, which is what makes a
 *     per-project colour worth choosing at all.
 *  2. The selected row sits on `--color-surface-selected-strong`. The mock's
 *     `--color-surface-selected` is 8 RGB points off the rail background and
 *     read as no change at all on this machine.
 *  3. The rail collapses to 48px. Collapsed it shows the chips and an icon
 *     footer — every affordance stays reachable except the per-project gear,
 *     which needs the width its row does not have when collapsed.
 */
const store = useProjectStore()

defineProps<{ viewMode: ViewMode }>()

/** The mode toggle and the settings entry stay App.vue's to perform — the rail
 *  renders them and reports the click, exactly as it does for project focus.
 *  `openProjectSettings` carries the id: the gear must be able to open the
 *  settings for a project WITHOUT selecting it first, or clicking the gear on
 *  an inactive project would silently switch workspaces under the user. */
const emit = defineEmits<{
  toggleMode: []
  openSettings: []
  openProjectSettings: [projectId: string]
  /** ⚠ AN EMIT, WHERE THIS USED TO CALL `store.add()` DIRECTLY. Adding a
   *  project now ends on the project settings screen, and the rail cannot
   *  navigate — App.vue owns `activeView`. The rail still reports the click;
   *  what happens after it is the app's decision, not the rail's. */
  addProject: []
  /** ⚠ CARRIES NO ID, UNLIKE `openProjectSettings`. The Docket is always the
   *  ACTIVE project's — a council is convened against the project you are working
   *  in, and `council_runs.project_id` records that. Letting the rail open some
   *  other project's history without switching to it would put a "New council"
   *  button in front of a project the app is not pointed at. */
  openCouncil: []
}>()

/**
 * ⚠ THE INDEX CYCLE IS NOW A FALLBACK, NOT THE RULE, and `chipColorValue`
 * (imported above, from `projectChip.ts`) is where it lives — so the settings
 * screen resolves the SAME colour this rail draws. Projects created from
 * migration v13 on carry a stored `color`; the three spine tokens are what a
 * PRE-v13 row (whose colour was never stored, because nothing stored it) still
 * renders as, so existing projects look exactly as they did before the column
 * existed. Do not "simplify" the fallback away — deleting it repaints every
 * project older than v13.
 *
 * ⚠ AND THE CYCLE IS FED BY `p.color_seed`, NOT BY THE `v-for` INDEX (v15).
 * The loop index was right only while this rail rendered every project in
 * creation order; the moment it partitions or reorders, the index is a position
 * in a sub-array and every pre-v13 project below the change repaints. The seed
 * is that index, frozen at migration time. This `v-for` therefore no longer
 * binds `i` at all — there is nothing left in this component that a project's
 * POSITION is allowed to decide.
 */

/** "1 session" / "5 sessions" — the mock writes both forms. A project with none
 *  reads `0 sessions`, which is a TRUE count and not a D76 placeholder: the
 *  rule forbids a zero standing in for a fact the app cannot produce, and this
 *  fact it can (D80 puts `sessionCount` on every `project:list` row). */
function sessionLabel(n: number): string {
  return n === 1 ? '1 session' : `${n} sessions`
}

/* ------------------------------------------------------------------ */
/* Collapse                                                            */
/* ------------------------------------------------------------------ */

/**
 * ⚠ PERSISTED IN localStorage, NOT IN THE DATABASE, and that is a deliberate
 * boundary rather than a shortcut. Everything main persists is a fact about
 * the WORK — which project is active, what the layout is, which sessions were
 * running. This is a fact about the WINDOW, of the same family as a sidebar
 * width, and routing it through a new IPC channel and a settings row would
 * make main the authority on something it can never have an opinion about.
 *
 * It reads on mount rather than at module scope so the component stays
 * mountable under SSR/test environments that have no `window`, and a
 * throwing/absent store degrades to "expanded" instead of a blank rail.
 */
const COLLAPSE_KEY = 'chorus.rail.collapsed'
const collapsed = ref(false)

onMounted(() => {
  try {
    collapsed.value = window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    collapsed.value = false
  }
})

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
  try {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0')
  } catch {
    // A blocked storage quota must not cost the user the click they just made.
  }
}
</script>

<template>
  <div class="rail" :class="{ 'rail-is-collapsed': collapsed }" data-testid="project-rail">
    <div class="rail-head">
      <div v-if="!collapsed" class="rail-eyebrow">PROJECTS</div>
      <button
        type="button"
        class="rail-toggle"
        :title="collapsed ? 'Expand the project panel' : 'Collapse the project panel'"
        :aria-label="collapsed ? 'Expand the project panel' : 'Collapse the project panel'"
        :aria-expanded="!collapsed"
        data-testid="rail-toggle"
        @click="toggleCollapsed"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path :d="collapsed ? 'M4.5 2.5 8 6l-3.5 3.5' : 'M7.5 2.5 4 6l3.5 3.5'" />
          <path d="M10 2v8" :opacity="collapsed ? 0.45 : 0.7" />
        </svg>
      </button>
    </div>

    <div class="rail-items">
      <div v-for="p in store.projects" :key="p.id" class="rail-item-wrap">
        <button
          type="button"
          class="rail-item"
          :class="{ 'rail-item-active': p.id === store.activeId }"
          :title="collapsed ? `${p.name} — ${p.root_path}` : p.root_path"
          @click="store.select(p.id)"
        >
          <!-- The colour chip. Wider and shorter than the 2px spine it replaces,
               and ALWAYS the project's own colour — dimmed when inactive, full
               strength plus a glow when selected. The hex rides a custom
               property so the glow can be written in CSS rather than assembled
               in JS; it is `#RRGGBB`-validated on the IPC boundary, which is
               what makes interpolating it into a style binding safe. -->
          <span class="rail-chip" :style="{ '--chip': chipColorValue(p.color, p.color_seed) }" />
          <template v-if="!collapsed">
            <span class="rail-item-row">
              <span class="rail-item-name">{{ p.name }}</span>
            </span>
            <span class="rail-item-sub">{{ sessionLabel(p.sessionCount) }}</span>
          </template>
        </button>

        <!-- ⚠ A SIBLING OF THE ITEM BUTTON, NOT A CHILD. A button inside a
             button is invalid HTML and browsers resolve it by dropping one of
             them — the gear would work until it silently did not. Absolutely
             positioned over the row instead, so the row stays one big click
             target for `select`. -->
        <button
          v-if="!collapsed"
          type="button"
          class="rail-gear"
          :class="{ 'rail-gear-shown': p.id === store.activeId }"
          :title="`${p.name} settings`"
          :aria-label="`${p.name} settings`"
          @click="emit('openProjectSettings', p.id)"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.1"
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="1.7" />
            <path
              d="M6 1.2v1.3M6 9.5v1.3M1.2 6h1.3M9.5 6h1.3M2.6 2.6l.9.9M8.5 8.5l.9.9M9.4 2.6l-.9.9M3.5 8.5l-.9.9"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>

    <div class="rail-spacer" />

    <!-- ⚠ THE ADD-PROJECT AFFORDANCE. The mock's rail draws no such control;
         this row is here because the deleted tab bar's `+ Add Project` was the
         app's ONLY route to `store.add()`, and losing it in a restyle would be
         the phase's single most likely behavioural regression. It takes the
         mock's own bottom-row geometry so it reads as part of the design.
         Collapsed, the same three controls become icons — dropping them at
         48px would be the same regression by another route. -->
    <div class="rail-footer">
      <button
        type="button"
        class="rail-action"
        title="Add a project folder"
        aria-label="Add a project folder"
        @click="emit('addProject')"
      >
        <span v-if="!collapsed" class="rail-action-label">Add project</span>
        <span class="rail-action-glyph" aria-hidden="true">+</span>
      </button>
      <button
        type="button"
        class="rail-action"
        :title="viewMode === 'filmstrip' ? 'Switch to grid view' : 'Switch to filmstrip view'"
        :aria-label="viewMode === 'filmstrip' ? 'Switch to grid view' : 'Switch to filmstrip view'"
        @click="emit('toggleMode')"
      >
        <span v-if="!collapsed" class="rail-action-label">
          {{ viewMode === 'filmstrip' ? 'Grid view' : 'Filmstrip view' }}
        </span>
        <svg
          v-else
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.1"
          aria-hidden="true"
        >
          <rect x="1.2" y="1.2" width="4" height="4" rx="0.8" />
          <rect x="6.8" y="1.2" width="4" height="4" rx="0.8" />
          <rect x="1.2" y="6.8" width="4" height="4" rx="0.8" />
          <rect x="6.8" y="6.8" width="4" height="4" rx="0.8" />
        </svg>
      </button>
      <!-- ⚠ THE COUNCIL'S ONLY AFFORDANCE IN THE WORKSPACE. Before this it was
           reachable solely by Ctrl+Shift+K and the palette, neither of which
           mentions a project — so a feature that records every run against
           `council_runs.project_id` had nothing tying it to a project anywhere a
           user could see. Disabled rather than hidden with no active project:
           the same rule `palette/commands.ts` already applies to `council.run`,
           and a control that vanishes teaches less than one that explains. -->
      <button
        type="button"
        class="rail-action"
        :disabled="store.activeId === null"
        :title="
          store.activeId === null
            ? 'Select a project to open its councils'
            : 'Councils for this project'
        "
        aria-label="Open this project’s councils"
        data-testid="rail-council"
        @click="emit('openCouncil')"
      >
        <span v-if="!collapsed" class="rail-action-label">Council</span>
        <!-- The seven-bar chorus mark, reduced to three strokes at 12px. -->
        <svg
          v-else
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M3 4.2v3.6M6 2.4v7.2M9 4.2v3.6" />
        </svg>
      </button>
      <button
        type="button"
        class="rail-action"
        title="Open settings"
        aria-label="Open settings"
        @click="emit('openSettings')"
      >
        <span v-if="!collapsed" class="rail-action-label">Settings</span>
        <!-- ⚠ SLIDERS, NOT A GEAR, and only because the gear now means
             something else in this rail: it is the PER-PROJECT settings glyph
             on every row above. Two gears one column apart, opening two
             different screens, is a coin toss for the user. -->
        <svg
          v-else
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.1"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M1.5 3.2h9M1.5 8.8h9" />
          <circle cx="4.2" cy="3.2" r="1.3" />
          <circle cx="7.8" cy="8.8" r="1.3" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.rail {
  width: 208px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-rail);
  border-right: 1px solid var(--color-border-chrome);
  padding: 10px 0 8px;
  user-select: none;
  overflow: hidden;
  transition: width 160ms ease;
}

.rail-is-collapsed {
  width: 48px;
}

@media (prefers-reduced-motion: reduce) {
  .rail {
    transition: none;
  }
}

.rail-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px 8px 14px;
}

.rail-is-collapsed .rail-head {
  padding: 0 0 8px;
  justify-content: center;
}

.rail-eyebrow {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: var(--color-text-eyebrow);
  white-space: nowrap;
  overflow: hidden;
}

.rail-toggle {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  color: var(--color-text-eyebrow);
  cursor: default;
}

.rail-toggle:hover {
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
}

/* Scrolls rather than squeezing the footer away once the list is long — the
   add-project row must stay reachable at any project count. */
.rail-items {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}

.rail-is-collapsed .rail-items {
  padding: 0 6px;
}

.rail-item-wrap {
  position: relative;
}

.rail-item {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--radius-rail);
  padding: 9px 10px 9px 18px;
  background: transparent;
  cursor: default;
}

.rail-is-collapsed .rail-item {
  padding: 9px 0;
  min-height: 32px;
}

.rail-item:hover {
  background: var(--color-surface-hover);
}

/* Brighter than the shared --color-surface-selected: this row has to announce
   itself across a 208px column of near-black, and the mock's value did not. */
.rail-item-active,
.rail-item-active:hover {
  background: var(--color-surface-selected-strong);
  border-color: var(--color-border-inset);
}

/* ── The colour chip ──────────────────────────────────────────────────────
   Was 2px wide × the row's full height. Now 5px × 18px, vertically centred:
   wider and shorter, which is what makes it read as a deliberate colour
   rather than a hairline rule. */
.rail-chip {
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 5px;
  height: 18px;
  border-radius: 3px;
  background: var(--chip);
  /* Inactive chips are dimmed — the .55 the old spine applied to every one of
     them, now the DIFFERENCE between states rather than a constant. */
  opacity: 0.55;
  transition: opacity 140ms ease, box-shadow 140ms ease;
}

.rail-is-collapsed .rail-chip {
  left: 50%;
  transform: translate(-50%, -50%);
  width: 6px;
  height: 20px;
}

/* Full strength plus a halo in the project's own colour. Two layers: a tight
   ring that keeps the chip's edge crisp, and a wide soft bloom that is the
   part you notice from across the window. */
.rail-item-active .rail-chip {
  opacity: 1;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--chip) 45%, transparent),
    0 0 10px 1px color-mix(in srgb, var(--chip) 55%, transparent);
}

/* Hovering an inactive project previews its colour rather than leaving it
   flat — the chip is the thing this rail is now organised around. */
.rail-item:hover .rail-chip {
  opacity: 0.85;
}

@media (prefers-reduced-motion: reduce) {
  .rail-chip {
    transition: none;
  }
}

.rail-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  /* Room for the gear, so a long project name ellipsizes before it collides
     with a control that only appears on hover. */
  padding-right: 20px;
}

.rail-item-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rail-item-active .rail-item-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.rail-item-sub {
  display: block;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-eyebrow);
}

.rail-item-active .rail-item-sub {
  color: var(--color-text-quiet);
}

/* ── The per-project gear ─────────────────────────────────────────────────
   Hidden until the row is hovered or active, so a rail at rest stays as quiet
   as the mock draws it. `opacity` rather than `display`, so the button keeps
   its box and the hover target does not jump under the cursor. */
.rail-gear {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  color: var(--color-text-eyebrow);
  opacity: 0;
  cursor: default;
  transition: opacity 120ms ease;
}

.rail-item-wrap:hover .rail-gear,
.rail-gear-shown,
.rail-gear:focus-visible {
  opacity: 1;
}

.rail-gear:hover {
  background: var(--color-surface-icon-hover);
  color: var(--color-text-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .rail-gear {
    transition: none;
  }
}

.rail-spacer {
  flex: 1;
}

.rail-footer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px 0;
  border-top: 1px solid var(--color-border-chrome);
  margin-top: 8px;
}

.rail-is-collapsed .rail-footer {
  padding: 6px 6px 0;
}

.rail-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  color: var(--color-text-eyebrow);
  cursor: default;
}

.rail-is-collapsed .rail-action {
  justify-content: center;
  padding: 7px 0;
}

.rail-action:hover {
  background: var(--color-surface-hover);
}

/* ⚠ A DISABLED ROW MUST NOT LIGHT UP UNDER THE CURSOR. Without this the Council
   entry with no project selected still takes the hover background and reads as
   pressable, which is the one impression a disabled control exists to avoid.
   The title attribute says why it is unavailable. */
.rail-action:disabled {
  opacity: 0.4;
}

.rail-action:disabled:hover {
  background: transparent;
}

/* Quiet by default, brightening on hover (spec §2) — the mock's bottom rows
   sit at --color-text-secondary, but this row is an app affordance the design
   never drew, and it should not compete with the projects above it. */
.rail-action-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 12px;
  color: var(--color-text-quiet);
}

.rail-action-glyph {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-eyebrow);
}

.rail-action:hover .rail-action-label {
  color: var(--color-text-secondary);
}

.rail-action:hover {
  color: var(--color-text-secondary);
}

.rail-action:hover .rail-action-glyph {
  color: var(--color-text-quiet);
}
</style>

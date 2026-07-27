<script setup lang="ts">
import type { ViewMode } from '../../../shared/ipc'
import { useProjectStore } from '../stores/project'

/**
 * The 208px project rail (Task 3c-3), which REPLACES the deleted project tab
 * bar — the design has a left rail, not a top tab bar, so this is the one
 * component in Phase 3c that is rewritten rather than restyled.
 *
 * ⚠ THE BEHAVIOUR CONTRACT IS UNCHANGED AND IS THE WHOLE POINT: `store.projects`,
 * `store.activeId`, `store.select(id)`, `store.add()`. A rail written as a
 * `v-for` over projects and nothing else silently drops `add()`, and THE APP HAS
 * NO OTHER ROUTE TO ADDING A PROJECT — hence the bottom row below, which the
 * mock does not draw and which this file exists to keep.
 *
 * Geometry and colour are read from the `<!-- left rail: projects -->` block of
 * docs/design/v2/Chorus Workspace.dc.html (D73). Every value is a 3c-1 token;
 * this file contains no raw hex, which a grep gate asserts.
 *
 * ⚠ TWO THINGS THE MOCK DRAWS HERE ARE DELIBERATELY ABSENT:
 *  - the per-project cost the mock prints after the session count — D76:
 *    `attribution:summary` is account-scoped and windowed (F35), so there is no
 *    per-project figure. The session count ships; the cost is omitted rather
 *    than faked, and NOTHING — no zeroed figure, no dash, no skeleton — stands
 *    in its place.
 *  - the attention badge (`◆ 2`) — D78: the renderer cannot know an agent is
 *    blocked on a human. `sessionStatusSchema` is `running | exited`, and the
 *    `attention:*` machinery measures the HUMAN's attention, not the agent's
 *    state. Phase 4 owns that capability and its badge.
 *
 * The mock's other three bottom rows (New session · Needs you · Mission control)
 * are Phase 4/5 surfaces and are likewise not drawn here — but the footer they
 * define IS the design's home for app-level actions, which is why the two
 * controls that used to sit in the deleted tab-bar row (the filmstrip/grid
 * toggle and the settings entry) land here rather than being dropped. ⚠ THE
 * WORKSPACE MOCK HAS NO ROW FOR THEM ANYWHERE, and losing them would be the
 * same silent-affordance-regression as losing `add()`.
 *
 * ⚠ NO KEYCAPS ON THESE ROWS. The mock prints `ctrl+t` / `ctrl+i` / `ctrl+m`
 * beside its own; Chorus binds none of them (Ctrl+K, the palette, is the only
 * global key), and a keycap for a shortcut that does nothing is an invented
 * fact in the same family D76 forbids.
 */
const store = useProjectStore()

defineProps<{ viewMode: ViewMode }>()

/** The mode toggle and the settings entry stay App.vue's to perform — the rail
 *  renders them and reports the click, exactly as it does for project focus. */
const emit = defineEmits<{ toggleMode: []; openSettings: [] }>()

/**
 * Inactive spine colour, assigned by LIST INDEX — deterministically, and
 * explicitly not by hashing the name, so renaming a project never moves its
 * colour. (`store.projects` is ordered by `created_at` in main.)
 *
 * ⚠ THE MOCK'S SECOND SPINE IS `rgba(208,138,78,.55)` — `#D08A4E`, A COLOUR
 * 3c-1 DID NOT TOKENISE. Reported rather than added (the token block is 3c-1's
 * and this task may not edit it), so the cycle runs over the three spine tokens
 * that DO exist. The .55 alpha the mock applies to every inactive spine is the
 * `opacity` below, which is exactly equivalent on an empty 2px element.
 */
const SPINES = [
  'var(--color-spine-violet)',
  'var(--color-spine-sand)',
  'var(--color-spine-blue)'
] as const

function spineColor(index: number): string {
  return SPINES[index % SPINES.length]
}

/** "1 session" / "5 sessions" — the mock writes both forms. A project with none
 *  reads `0 sessions`, which is a TRUE count and not a D76 placeholder: the
 *  rule forbids a zero standing in for a fact the app cannot produce, and this
 *  fact it can (D80 puts `sessionCount` on every `project:list` row). */
function sessionLabel(n: number): string {
  return n === 1 ? '1 session' : `${n} sessions`
}
</script>

<template>
  <div class="rail" data-testid="project-rail">
    <div class="rail-eyebrow">PROJECTS</div>

    <div class="rail-items">
      <button
        v-for="(p, i) in store.projects"
        :key="p.id"
        type="button"
        class="rail-item"
        :class="{ 'rail-item-active': p.id === store.activeId }"
        :title="p.root_path"
        @click="store.select(p.id)"
      >
        <!-- The 2px spine: periwinkle while active, the project's own dimmed
             colour otherwise. Absolutely positioned so it hugs the item's left
             edge inside the 14px left padding. -->
        <span
          class="rail-spine"
          :style="
            p.id === store.activeId
              ? { background: 'var(--color-accent-periwinkle)' }
              : { background: spineColor(i), opacity: 0.55 }
          "
        />
        <span class="rail-item-row">
          <span class="rail-item-name">{{ p.name }}</span>
        </span>
        <span class="rail-item-sub">{{ sessionLabel(p.sessionCount) }}</span>
      </button>
    </div>

    <div class="rail-spacer" />

    <!-- ⚠ THE ADD-PROJECT AFFORDANCE. The mock's rail draws no such control;
         this row is here because the deleted tab bar's `+ Add Project` was the
         app's ONLY route to `store.add()`, and losing it in a restyle would be
         the phase's single most likely behavioural regression. It takes the
         mock's own bottom-row geometry so it reads as part of the design. -->
    <div class="rail-footer">
      <button type="button" class="rail-action" title="Add a project folder" @click="store.add()">
        <span class="rail-action-label">Add project</span>
        <span class="rail-action-glyph" aria-hidden="true">+</span>
      </button>
      <button
        type="button"
        class="rail-action"
        :title="viewMode === 'filmstrip' ? 'Switch to grid view' : 'Switch to filmstrip view'"
        @click="emit('toggleMode')"
      >
        <span class="rail-action-label">
          {{ viewMode === 'filmstrip' ? 'Grid view' : 'Filmstrip view' }}
        </span>
      </button>
      <button
        type="button"
        class="rail-action"
        title="Open settings"
        @click="emit('openSettings')"
      >
        <span class="rail-action-label">Settings</span>
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
}

.rail-eyebrow {
  flex: none;
  padding: 2px 14px 8px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: var(--color-text-eyebrow);
}

/* Scrolls rather than squeezing the footer away once the list is long — the
   add-project row must stay reachable at any project count. */
.rail-items {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}

.rail-item {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--radius-rail);
  padding: 9px 10px 9px 14px;
  background: transparent;
  cursor: default;
}

.rail-item:hover {
  background: var(--color-surface-hover);
}

.rail-item-active,
.rail-item-active:hover {
  background: var(--color-surface-selected);
  border-color: var(--color-border-inset);
}

.rail-spine {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 1px;
}

.rail-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
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

.rail-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  cursor: default;
}

.rail-action:hover {
  background: var(--color-surface-hover);
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

.rail-action:hover .rail-action-glyph {
  color: var(--color-text-quiet);
}
</style>

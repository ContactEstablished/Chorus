<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { chipColorValue } from '../projectChip'
import { buildSwitcherRows, rowForDigit, type SwitcherRow } from '../projectSwitcher'
import type { RailProject } from '../projectRail'

/**
 * Ctrl+G — the project switcher (D180). One job, said in the header: switch to a
 * project. Three ways to do it, because they suit different moments:
 *
 *  · a DIGIT, for the project you switch to twenty times a day. Ctrl+G then 2
 *    is over before the list has finished being read, and the number is the
 *    rail position, so it is learnable by looking at the panel you already
 *    have open.
 *  · ↑/↓ AND ENTER, for when you know it is "one below the one I'm in".
 *  · A CLICK, for when you are already holding the mouse.
 *
 * ⚠ THERE IS NO SEARCH BOX, AND THAT IS THE DESIGN, NOT AN OMISSION. A text
 * input would make `2` mean "filter for the character 2" and the digits would
 * have to move to a modifier — which turns a two-key gesture into a three-key
 * one to serve a list that is nine rows long and sorted the way the user
 * arranged it. Fuzzy search over projects is what this replaced; if a rail ever
 * grows past what a screen holds, that is the moment to reconsider, not before.
 *
 * The ORDER and the NUMBERING live in `projectSwitcher.ts` (testable in node —
 * there are no `.vue` tests in this repo). This file owns the DOM, the keys and
 * the focus, and decides nothing.
 */
const props = defineProps<{
  projects: readonly RailProject[]
  activeId: string | null
}>()

const emit = defineEmits<{
  close: []
  select: [projectId: string]
}>()

const panel = ref<HTMLDivElement | null>(null)
const rows = computed<SwitcherRow[]>(() => buildSwitcherRows(props.projects, props.activeId))

/**
 * ⚠ THE HIGHLIGHT OPENS ON THE PROJECT YOU ARE IN, not on row one. "Down, enter"
 * then means the next project in the rail, which is the second most common
 * thing after "the one I know the number of" — starting at the top would make
 * the arrow route wrong by however far down the list you currently sit.
 */
const selectedIndex = ref(Math.max(0, rows.value.findIndex((r) => r.current)))

onMounted(() => {
  panel.value?.focus()
})

function move(delta: number): void {
  const n = rows.value.length
  if (n === 0) return
  selectedIndex.value = (selectedIndex.value + delta + n) % n
}

/**
 * ⚠ CHOOSING THE PROJECT YOU ARE ALREADY IN JUST CLOSES. It is listed to keep
 * the numbers below it still, so it is a landmark rather than a destination;
 * re-selecting it would run `project:select` for no reason, and that tears down
 * and re-attaches the pane tree you are looking at.
 */
function choose(row: SwitcherRow | null | undefined): void {
  if (!row) return
  emit('close')
  if (!row.current) emit('select', row.id)
}

function onRowClick(i: number): void {
  selectedIndex.value = i
  choose(rows.value[i])
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    move(e.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    choose(rows.value[selectedIndex.value])
    return
  }
  // ⚠ MODIFIED DIGITS ARE NOT ROW NUMBERS. Ctrl+1..9 is reserved for focusing
  // panes (docs/PLAN.md), and letting a bare `rowForDigit` see it would make
  // this overlay quietly answer a chord that means something else.
  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
    const row = rowForDigit(rows.value, e.key)
    if (row) {
      e.preventDefault()
      choose(row)
      return
    }
  }
  // Nothing here is tabbable, so Tab would move focus to the document BEHIND
  // the scrim and the arrow keys would stop working with the overlay still up.
  if (e.key === 'Tab') e.preventDefault()
}

/** The rail's phrasing, so the two panels describe a project the same way. */
function sessionLabel(n: number): string {
  return n === 1 ? '1 session' : `${n} sessions`
}
</script>

<template>
  <div class="overlay-scrim overlay-scrim-palette">
    <div
      ref="panel"
      class="overlay-panel overlay-panel-palette switcher"
      role="dialog"
      aria-modal="true"
      aria-label="Switch to a project"
      tabindex="-1"
      data-testid="project-switcher"
      @keydown="onKeydown"
    >
      <div class="overlay-header switcher-head">
        <span class="switcher-caret" aria-hidden="true">›</span>
        <span class="switcher-title">switch to a project</span>
        <span class="overlay-keycap">esc</span>
      </div>

      <ul class="overlay-body switcher-list" role="listbox" aria-label="Projects">
        <li
          v-for="(row, i) in rows"
          :key="row.id"
          class="switcher-row"
          :class="{ 'switcher-row-on': i === selectedIndex, 'switcher-row-current': row.current }"
          role="option"
          :aria-selected="i === selectedIndex"
          :title="row.root_path"
          @click="onRowClick(i)"
          @mouseenter="selectedIndex = i"
        >
          <!-- The digit keycap, or a blank of the same width past row nine, so
               the names stay in one column whatever the rail length. -->
          <span v-if="row.digit" class="switcher-digit">{{ row.digit }}</span>
          <span v-else class="switcher-digit switcher-digit-none" aria-hidden="true" />

          <span
            class="switcher-chip"
            :style="{ '--chip': chipColorValue(row.color, row.color_seed) }"
          />

          <span class="switcher-text">
            <span class="switcher-name">{{ row.name }}</span>
            <span class="switcher-sub">
              {{ sessionLabel(row.sessionCount) }}
              <!-- Says WHY a project is here but not in the rail proper — without
                   it, a hidden project reads as a rail the user has lost track of. -->
              <span v-if="row.tucked" class="switcher-tag">hidden</span>
            </span>
          </span>

          <span v-if="row.current" class="switcher-current">current</span>
        </li>
        <li v-if="rows.length === 0" class="switcher-empty">No projects to switch to</li>
      </ul>

      <div class="overlay-footer switcher-foot">1–9 jump · ↑↓ navigate · enter switch · esc close</div>
    </div>
  </div>
</template>

<style src="../assets/overlays.css"></style>

<style scoped>
/* Deliberately the command palette's anatomy at a narrower width — this is a
   sibling of Ctrl+K, not a new kind of surface, and a second visual language
   for "a list you pick from" would be the thing that made the app feel
   assembled rather than designed. */
.switcher {
  width: 460px;
}

.switcher:focus {
  outline: none; /* The highlighted ROW is the focus indicator. */
}

.switcher-head {
  padding: 12px 14px;
}

.switcher-caret {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-accent-jade);
}

.switcher-title {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-secondary);
}

.switcher-list {
  display: flex;
  flex-direction: column;
  padding: 6px;
}

/* The palette's row construction, including the always-present 2px left border
   that keeps the list from shifting as the highlight moves. */
.switcher-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--radius-icon);
  border-left: 2px solid transparent;
  cursor: default;
}

.switcher-row:hover:not(.switcher-row-on) {
  background: var(--color-surface-tile);
}

.switcher-row-on {
  background: color-mix(in srgb, var(--color-accent-jade) 8%, transparent);
  border-left-color: var(--color-accent-jade);
}

/* ⚠ MONO AND FIXED-WIDTH. The digits are a column you scan, not text you read;
   a proportional `1` beside a proportional `8` would put every name at a
   slightly different indent. */
.switcher-digit {
  flex: none;
  width: 18px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 16px;
  border: 1px solid var(--color-border-divider);
  background: var(--color-surface-keycap);
  border-radius: var(--radius-chip);
  color: var(--color-text-quiet);
}

.switcher-digit-none {
  border-color: transparent;
  background: transparent;
}

.switcher-row-on .switcher-digit {
  border-color: color-mix(in srgb, var(--color-accent-jade) 45%, transparent);
  color: var(--color-accent-jade);
}

/* The rail's chip, at the rail's proportions — this is how a project is
   identified everywhere else in the app. */
.switcher-chip {
  flex: none;
  width: 3px;
  height: 20px;
  border-radius: 2px;
  background: var(--chip);
  opacity: 0.55;
}

.switcher-row-on .switcher-chip {
  opacity: 1;
}

.switcher-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.switcher-name {
  font-size: 12.5px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.switcher-row-on .switcher-name {
  color: var(--color-text-primary);
}

.switcher-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-eyebrow);
}

.switcher-tag {
  border: 1px solid var(--color-border-divider);
  border-radius: var(--radius-chip);
  padding: 0 4px;
  color: var(--color-text-quiet);
}

.switcher-current {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--color-accent-jade);
  opacity: 0.75;
}

.switcher-empty {
  padding: 8px 10px;
  font-size: 12.5px;
  color: var(--color-text-eyebrow);
}

.switcher-foot {
  padding: 7px 14px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-eyebrow);
}
</style>

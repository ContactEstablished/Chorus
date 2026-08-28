<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  buildRoster,
  describeAddress,
  ROSTER_PARTIALITY_NOTE,
  type RosterPane
} from '../../../shared/fleetRoster'
import { useFleetStore } from '../stores/fleet'

/**
 * Who is reachable in this project, and who else is on the machine (D182 §7.2).
 *
 * ⚠ THIS COMPONENT DECIDES NOTHING. Every rule it appears to express — that an
 * unparticipating pane still gets a row, that unreadable is not empty, that the
 * two non-participation reasons stay apart — lives in `shared/fleetRoster.ts`
 * and is tested there, because this repository has no `.vue` tests and D186
 * records what that costs: a rule written in a component is a rule nothing can
 * check. Keep it that way; if a behaviour needs adding, add it there.
 *
 * ⚠ IT IS SOMEWHERE YOU GO, NEVER SOMETHING THAT SURFACES ITSELF. Council
 * FC-1.0 Q3 made the timeline's distinction from an activity feed depend on
 * being consulted rather than pushed, and the roster inherits that: no unread
 * counts, no badges, no notifications, no ambient placement.
 */
const props = defineProps<{ panes: readonly RosterPane[] }>()
const emit = defineEmits<{ close: []; focus: [sessionId: string] }>()

const fleet = useFleetStore()
const roster = computed(() => buildRoster(props.panes, fleet.snapshot))
const externalOpen = ref(false)
</script>

<template>
  <div class="roster-backdrop" @click.self="emit('close')">
    <div class="roster" role="dialog" aria-label="Fleet">
      <header class="roster-head">
        <h2>Fleet</h2>
        <button type="button" class="roster-close" title="Close" @click="emit('close')">✕</button>
      </header>

      <!-- Not a tooltip: §4.5 makes this a correctness statement, and a list
           that looks complete is a claim. -->
      <p class="roster-note">{{ ROSTER_PARTIALITY_NOTE }}</p>

      <p v-if="!roster.readable" class="roster-unreadable">
        The session registry could not be read, so no address can be confirmed right now.
        <!-- ⚠ NOT an empty list: that would say "there are no peers", which is
             a different and much stronger claim than "we cannot say". -->
      </p>

      <section>
        <h3>This project</h3>
        <ul class="roster-list">
          <li v-for="row in roster.panes" :key="row.sessionId" class="roster-row">
            <button
              type="button"
              class="roster-row-btn"
              :class="{ 'roster-row-dim': !row.addressable }"
              @click="emit('focus', row.sessionId)"
            >
              <span class="roster-dot" :class="'roster-dot-' + (row.status ?? 'none')" />
              <span class="roster-label">{{ row.label }}</span>
              <span class="roster-address">
                <template v-if="row.addressable">{{ describeAddress(row.address) }}</template>
                <template v-else-if="row.reason === 'not-claude'">Not addressable</template>
                <template v-else>Not addressable (no registry entry)</template>
              </span>
              <span class="roster-status">{{ row.status ?? '' }}</span>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="roster.external.length > 0">
        <!-- Collapsed by default: hiding them would misrepresent the fleet, but
             expanding them would make other people's sessions the loudest thing
             in a view about your own project. -->
        <button type="button" class="roster-toggle" @click="externalOpen = !externalOpen">
          {{ externalOpen ? '▾' : '▸' }} Other sessions on this machine ({{ roster.external.length }})
        </button>
        <ul v-if="externalOpen" class="roster-list">
          <!-- ⚠ NO ACTIONS. These are real and reachable, and they are not ours
               to focus, kill or message. -->
          <li v-for="peer in roster.external" :key="peer.name + peer.cwd" class="roster-row">
            <div class="roster-row-static">
              <span class="roster-dot" :class="'roster-dot-' + peer.status" />
              <span class="roster-label">{{ peer.name }}</span>
              <span class="roster-address roster-cwd">{{ peer.cwd }}</span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.roster-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-scrim);
  z-index: 40;
}
.roster {
  width: min(680px, 90vw);
  max-height: 80vh;
  overflow: auto;
  padding: 16px 18px 20px;
  border-radius: 10px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
}
.roster-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.roster-head h2 {
  font-size: 15px;
  margin: 0;
}
.roster-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
}
.roster-note {
  margin: 6px 0 14px;
  font-size: 11px;
  color: var(--color-text-muted);
}
.roster-unreadable {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--color-text-muted);
  font-style: italic;
}
.roster h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  margin: 12px 0 6px;
}
.roster-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.roster-row-btn,
.roster-row-static {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
.roster-row-btn {
  cursor: pointer;
}
.roster-row-btn:hover {
  background: var(--color-bg-hover);
}
.roster-row-dim {
  opacity: 0.65;
}
.roster-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-border-subtle);
}
.roster-dot-busy {
  background: var(--color-accent-jade);
}
.roster-dot-idle {
  background: var(--color-text-muted);
}
.roster-label {
  flex: 0 0 auto;
  font-weight: 500;
}
.roster-address {
  flex: 1 1 auto;
  font-size: 12px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.roster-cwd {
  font-size: 11px;
}
.roster-status {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--color-text-muted);
}
.roster-toggle {
  margin-top: 14px;
  background: none;
  border: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LayoutJson } from '../../../shared/layout'
import { collectSessionIds } from '../../../shared/layout'
import type { AgentKind, SessionInfo } from '../../../shared/ipc'
import TerminalPane from './TerminalPane.vue'
import type { SplitTarget } from '../stores/layout'

/**
 * Filmstrip view (Task 1b-2 / D20): one focused session as a full
 * TerminalPane, every other leaf a compact card in a strip along the bottom
 * edge. Consumes the SAME persisted tree + agentFor contract the spike
 * validated (docs/architecture/spike-filmstrip-notes.md) and writes NOTHING
 * to the layout store — focus flows out as an event, never a tree mutation.
 * Cards are plain flexbox: no xterm, no canvas, no PTY stream, no badge (F10).
 */
const props = defineProps<{
  tree: LayoutJson
  /** layout:get rows — the cards' only metadata source (title/status/
   *  exitCode/createdAt). Deliberately NOT the session store: it keys off
   *  attach and cards never attach. Persisted titles are naturally static
   *  (F12a) — no live title stream reaches a card. */
  sessions: SessionInfo[]
  /** App's resolved effective focus (the F4 fallback already applied). */
  focusedSessionId: string
  /** Leaf sessionId -> agent kind; undefined when the session row is gone. */
  agentFor: (id: string) => AgentKind | undefined
}>()

/** Card click / focused-pane focus -> App (view store); split -> launch dialog. */
const emit = defineEmits<{ focus: [sessionId: string]; split: [target: SplitTarget] }>()

const labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }

const ids = computed(() => collectSessionIds(props.tree.root))
const cardIds = computed(() => ids.value.filter((id) => id !== props.focusedSessionId))

function infoFor(id: string): SessionInfo | undefined {
  return props.sessions.find((s) => s.id === id)
}

/** ONE shared clock at 60 s granularity: every card derives its elapsed label
 *  from this single ref — never a per-card or per-second timer. */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})
onBeforeUnmount(() => clearInterval(clock))

function elapsed(id: string): string {
  const info = infoFor(id)
  if (!info) return ''
  const mins = Math.floor((now.value - Date.parse(info.createdAt)) / 60_000)
  // NaN (unparseable createdAt) and clock skew both land in the first bucket.
  if (!(mins >= 1)) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return hrs < 24 ? `${hrs}h` : `${Math.floor(hrs / 24)}d`
}

/** Same palette as TerminalPane's header dot, derived from the persisted row
 *  (status + exitCode) instead of the attach-keyed session store. */
function dotClass(id: string): string {
  const info = infoFor(id)
  if (!info) return 'bg-neutral-700'
  if (info.status === 'running') return 'bg-green-500'
  return info.exitCode === 0 ? 'bg-neutral-500' : 'bg-red-500'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="min-h-0 flex-1">
      <!-- Keyed by session id so a focus swap is a clean remount (F5): the old
           pane's cleanup runs, the hidden PTY keeps running in main, and the
           next attach replays its buffer. -->
      <TerminalPane
        v-if="agentFor(focusedSessionId)"
        :key="focusedSessionId"
        :session-id="focusedSessionId"
        :agent="(agentFor(focusedSessionId) as AgentKind)"
        @split="(target) => emit('split', target)"
        @focus="(id) => emit('focus', id)"
      />
      <div
        v-else
        class="flex h-full items-center justify-center bg-[#1e1e1e] text-xs text-neutral-500 select-none"
      >
        Session no longer exists
      </div>
    </div>
    <div
      v-if="cardIds.length > 0"
      class="flex shrink-0 gap-2 overflow-x-auto border-t border-neutral-800 bg-neutral-900 p-2"
    >
      <button
        v-for="id in cardIds"
        :key="id"
        class="flex w-44 shrink-0 flex-col gap-1 rounded border border-neutral-700 bg-neutral-900 p-2 text-left hover:border-sky-500"
        @click="emit('focus', id)"
      >
        <div class="flex items-center gap-1.5">
          <span class="inline-block h-2 w-2 shrink-0 rounded-full" :class="dotClass(id)" />
          <!-- Agent label + title compose the card identity (F12b): same-project
               Codex titles collide (cwd basename), so the title alone never
               identifies a card. -->
          <span class="truncate text-xs font-medium text-neutral-200">
            {{ agentFor(id) ? labels[agentFor(id) as AgentKind] : 'Unknown' }}
          </span>
        </div>
        <span class="truncate text-xs text-neutral-400" :title="infoFor(id)?.title ?? ''">
          {{ infoFor(id)?.title ?? '—' }}
        </span>
        <span class="text-[10px] text-neutral-500">{{ elapsed(id) }}</span>
      </button>
    </div>
  </div>
</template>

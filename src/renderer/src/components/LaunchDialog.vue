<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AgentKind, AttachResponse } from '../../../shared/ipc'

/**
 * Launch dialog (Task 1-4): pick an agent + cwd, launch via session:launch.
 * Agent cards are capability-driven by cli:detect — an undetected agent is a
 * disabled card with a "not found" note, never a hidden or broken option.
 * Validation failures ({ok:false}) render inline; the dialog stays open.
 */
const emit = defineEmits<{
  cancel: []
  launched: [payload: { agent: AgentKind; snapshot: AttachResponse }]
}>()

/** The active project's id — threaded into both project-aware IPC calls
 *  (Task 1-5: session:launch-context and session:launch resolve it in main). */
const props = defineProps<{ projectId: string }>()

const labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }
const AGENT_KINDS: AgentKind[] = ['claude', 'codex']

interface AgentCard {
  name: AgentKind
  found: boolean
  version: string | null
}

const panel = ref<HTMLDivElement | null>(null)
const cwdInput = ref<HTMLInputElement | null>(null)
const agents = ref<AgentCard[]>([])
const selected = ref<AgentKind | null>(null)
const cwd = ref('')
const projectRoot = ref('')
const recentCwds = ref<string[]>([])
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  const [clis, ctx] = await Promise.all([
    window.chorus.detectClis(),
    window.chorus.getLaunchContext(props.projectId)
  ])
  agents.value = AGENT_KINDS.map((name) => {
    const detected = clis.find((c) => c.name === name)
    return { name, found: detected?.found ?? false, version: detected?.version ?? null }
  })
  projectRoot.value = ctx.projectRoot
  recentCwds.value = ctx.recentCwds
  cwd.value = ctx.projectRoot
  selected.value = agents.value.find((a) => a.found)?.name ?? null
  cwdInput.value?.focus()
})

function cancel(): void {
  emit('cancel')
}

async function submit(): Promise<void> {
  if (!selected.value || !cwd.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await window.chorus.launch({
      project_id: props.projectId,
      agent: selected.value,
      cwd: cwd.value
    })
    if ('ok' in res) {
      error.value = res.reason
      return
    }
    emit('launched', { agent: selected.value, snapshot: res })
  } catch (e) {
    // Rejected invoke (e.g. spawn failure in main) — same inline treatment.
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

/** Basic focus trap: Tab/Shift-Tab cycle within the panel; Esc cancels. */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    cancel()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const focusables = Array.from(
    panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (e.shiftKey && active === first) {
    last.focus()
    e.preventDefault()
  } else if (!e.shiftKey && active === last) {
    first.focus()
    e.preventDefault()
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @keydown="onKeydown">
    <div ref="panel" class="w-[28rem] rounded-lg bg-neutral-900 p-5 shadow-xl" role="dialog" aria-modal="true">
      <h2 class="text-sm font-semibold text-neutral-200">Launch agent</h2>

      <!-- agent cards from cli:detect -->
      <div class="mt-3 grid grid-cols-2 gap-2">
        <button
          v-for="a in agents"
          :key="a.name"
          :disabled="!a.found"
          :class="[
            selected === a.name ? 'ring-2 ring-sky-500' : 'ring-1 ring-neutral-700',
            !a.found && 'opacity-40 cursor-not-allowed'
          ]"
          class="rounded-md p-3 text-left"
          @click="selected = a.name"
        >
          <div class="text-neutral-100">{{ labels[a.name] }}</div>
          <div class="text-xs text-neutral-400">
            {{ a.found ? a.version : 'not found' }}
          </div>
        </button>
      </div>

      <!-- cwd -->
      <label class="mt-4 block text-xs text-neutral-400">Working directory</label>
      <input
        ref="cwdInput"
        v-model="cwd"
        class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-neutral-100"
        @keydown.enter="submit"
      />
      <div class="mt-1 flex flex-wrap gap-1">
        <button class="text-xs text-sky-400 hover:text-sky-300" @click="cwd = projectRoot">
          use project root
        </button>
        <button
          v-for="r in recentCwds"
          :key="r"
          class="text-xs text-neutral-400 hover:text-neutral-200"
          @click="cwd = r"
        >
          {{ r }}
        </button>
      </div>

      <p v-if="error" class="mt-2 text-xs text-red-400">{{ error }}</p>

      <div class="mt-5 flex justify-end gap-2">
        <button class="text-sm text-neutral-400 hover:text-neutral-200" @click="cancel">Cancel</button>
        <button
          class="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
          :disabled="!selected || !cwd || busy"
          @click="submit"
        >
          Launch
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AgentKind, AttachResponse, DetectedCli, PickableWorktree, WorkspaceMode } from '../../../shared/ipc'

/**
 * Launch dialog (Task 1-4): pick an agent + cwd, launch via session:launch.
 * Agent cards are capability-driven by cli:detect — an undetected agent is a
 * disabled card with a "not found" note, never a hidden or broken option.
 * Validation failures ({ok:false}) render inline; the dialog stays open.
 *
 * Task 2-2 (D22/D26f): the workspace-mode selector. Main computes the default
 * (suggestedMode) and the attachable-worktree list on session:launch-context;
 * the CHOSEN mode always travels explicitly in the launch payload — main
 * validates it, never silently overrides. A non-git project root shows an
 * inline "not a git repository" state and offers only current-tree.
 *
 * Task 3-3 (D34f): cards render from the WIRE — the adapter-supplied
 * agentKind/displayName on each cli:detect row. Nothing here hardcodes an
 * agent name or label anymore; card ORDER now derives from main's
 * DETECTED_TOOLS (the same order the deleted kind-list constant had).
 */
const emit = defineEmits<{
  cancel: []
  launched: [payload: { agent: AgentKind; snapshot: AttachResponse }]
}>()

/** The active project's id — threaded into both project-aware IPC calls
 *  (Task 1-5: session:launch-context and session:launch resolve it in main). */
const props = defineProps<{ projectId: string }>()

interface AgentCard {
  name: AgentKind
  label: string
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
const repoRoot = ref<string | null>(null)
const mode = ref<WorkspaceMode>('current-tree')
const pickable = ref<PickableWorktree[]>([])
const selectedWorktree = ref<string | null>(null)
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  const [clis, ctx] = await Promise.all([
    window.chorus.detectClis(),
    window.chorus.getLaunchContext(props.projectId)
  ])
  agents.value = clis
    .filter((c): c is DetectedCli & { agentKind: AgentKind } => c.agentKind !== null)
    .map((c) => ({
      name: c.agentKind,
      label: c.displayName ?? c.agentKind,
      found: c.found,
      version: c.version
    }))
  projectRoot.value = ctx.projectRoot
  recentCwds.value = ctx.recentCwds
  cwd.value = ctx.projectRoot
  // 2-2: main's suggestion is the default; the user may override it freely.
  repoRoot.value = ctx.repoRoot
  mode.value = ctx.suggestedMode
  pickable.value = ctx.worktrees
  selectedWorktree.value = ctx.worktrees[0]?.id ?? null
  selected.value = agents.value.find((a) => a.found)?.name ?? null
  cwdInput.value?.focus()
})

function cancel(): void {
  emit('cancel')
}

/** Mode-button styling mirrors the agent cards: the active choice wears the
 *  sky ring; an unavailable choice (no attachable worktrees) dims out. */
function modeClass(m: WorkspaceMode): string {
  return mode.value === m ? 'ring-2 ring-sky-500' : 'ring-1 ring-neutral-700'
}

async function submit(): Promise<void> {
  if (!selected.value || !cwd.value || busy.value) return
  if (mode.value === 'existing-worktree' && !selectedWorktree.value) return
  busy.value = true
  error.value = ''
  try {
    // D14: a fresh literal of primitives — nothing store-sourced crosses.
    // The mode ALWAYS travels explicitly; worktree_id rides along only for
    // existing-worktree (main ignores it otherwise).
    const res = await window.chorus.launch({
      project_id: props.projectId,
      agent: selected.value,
      cwd: cwd.value,
      workspace_mode: mode.value,
      ...(mode.value === 'existing-worktree' && selectedWorktree.value
        ? { worktree_id: selectedWorktree.value }
        : {})
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
    panel.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled])'
    )
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
          <div class="text-neutral-100">{{ a.label }}</div>
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

      <!-- workspace mode (2-2 / D22): a non-git project root offers only
           current-tree, with the inline note (findings risk 3). -->
      <label class="mt-4 block text-xs text-neutral-400">Workspace</label>
      <div v-if="repoRoot === null" class="mt-1 text-xs text-neutral-500">
        Not a git repository — launching in the current working tree.
      </div>
      <div v-else class="mt-1 flex gap-2">
        <button :class="modeClass('current-tree')" class="rounded-md px-3 py-1 text-xs text-neutral-100" @click="mode = 'current-tree'">
          Current tree
        </button>
        <button :class="modeClass('new-worktree')" class="rounded-md px-3 py-1 text-xs text-neutral-100" @click="mode = 'new-worktree'">
          New worktree
        </button>
        <button
          :class="modeClass('existing-worktree')"
          :disabled="pickable.length === 0"
          class="rounded-md px-3 py-1 text-xs text-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Attach to a worktree an earlier session left behind"
          @click="mode = 'existing-worktree'"
        >
          Existing worktree
        </button>
      </div>
      <select
        v-if="mode === 'existing-worktree' && repoRoot !== null"
        v-model="selectedWorktree"
        class="mt-2 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
      >
        <option v-for="w in pickable" :key="w.id" :value="w.id">{{ w.branch }} — {{ w.path }}</option>
      </select>

      <p v-if="error" class="mt-2 text-xs text-red-400">{{ error }}</p>

      <div class="mt-5 flex justify-end gap-2">
        <button class="text-sm text-neutral-400 hover:text-neutral-200" @click="cancel">Cancel</button>
        <button
          class="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
          :disabled="!selected || !cwd || busy || (mode === 'existing-worktree' && !selectedWorktree)"
          @click="submit"
        >
          Launch
        </button>
      </div>
    </div>
  </div>
</template>

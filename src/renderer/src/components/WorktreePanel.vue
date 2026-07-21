<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { WorktreeSummary } from '../../../shared/ipc'

/**
 * Retained-worktree panel (Task 2-3 / D26g): a MINIMAL overlay dialog on the
 * LaunchDialog focus-trap idiom (fixed inset, bg-black/50, role="dialog"
 * aria-modal, Tab-trap, Esc-cancel) — deliberately NOT a settings panel.
 *
 * Rows come from worktree:list (main recomputes cleanliness and prune
 * candidacy live). Removal honors the D26 gates: clean rows confirm with one
 * click; dirty rows show the dirty file list and require the exact path
 * typed before the confirm button enables; "Also delete branch" is opt-in
 * and UNCHECKED by default (D26 Q4); prune candidates (dir gone) act only on
 * an explicit click (never automatic, D26 Q3). Orphan directories
 * (population 5, nil-uuid sentinel) are informational only — Chorus never
 * deletes them. NO window.confirm anywhere (it blocks the renderer thread).
 */
const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ close: [] }>()

/** Sentinel id main uses for row-less orphan-directory entries. */
const ORPHAN_ID = '00000000-0000-0000-0000-000000000000'

const panel = ref<HTMLDivElement | null>(null)
const rows = ref<WorktreeSummary[]>([])
const loading = ref(true)

/** Inline confirmation state — one row expanded at a time. */
const expandedKey = ref<string | null>(null)
const expandedDirty = ref<string[]>([])
const typedPath = ref('')
const deleteBranch = ref(false)
const busy = ref(false)
/** Panel-level action result (errors AND "worktree removed, branch kept"
 *  notices) — hoisted out of the row so it survives a row disappearing. */
const actionMessage = ref<string | null>(null)

let unmounted = false

onMounted(async () => {
  const list = await window.chorus.listWorktrees(props.projectId)
  // F13: the panel may have been closed while the list call was in flight —
  // bail before touching state rather than resurrect a dead overlay.
  if (unmounted) return
  rows.value = list
  loading.value = false
})

onBeforeUnmount(() => {
  unmounted = true
})

async function refresh(): Promise<void> {
  rows.value = await window.chorus.listWorktrees(props.projectId)
}

function rowKey(row: WorktreeSummary): string {
  return row.id === ORPHAN_ID ? `orphan:${row.path}` : row.id
}

function isOrphan(row: WorktreeSummary): boolean {
  return row.id === ORPHAN_ID
}

const expandedRow = computed(
  () => rows.value.find((r) => rowKey(r) === expandedKey.value) ?? null
)

/** The typed-token gate mirrors main's dirtyRemovalAllowed (the renderer
 *  cannot import shared/ipc.ts's value exports — Zod is main-only, D1 — so
 *  the one-line comparison is duplicated here; main remains the authority
 *  and re-checks at execution time). The token is required for a DIRTY
 *  removal — and, being the same acknowledgment (D26(j)), it then also
 *  licenses the -D branch escalation when "Also delete branch" is checked.
 *  A clean removal with deleteBranch simply attempts -d: an unmerged refusal
 *  is surfaced as the action result (never swallowed, never force-deleted). */
const needsToken = computed(() => {
  const row = expandedRow.value
  return row !== null && !row.isPruneCandidate && expandedDirty.value.length > 0
})
const canConfirm = computed(
  () => !busy.value && (!needsToken.value || typedPath.value === expandedRow.value?.path)
)

async function toggleExpand(row: WorktreeSummary): Promise<void> {
  if (expandedKey.value === rowKey(row)) {
    expandedKey.value = null
    return
  }
  expandedKey.value = rowKey(row)
  typedPath.value = ''
  deleteBranch.value = false
  actionMessage.value = null
  // FRESH cleanliness read at expand time (never the list-time snapshot);
  // main re-checks once more at execution — defense in depth. A failed read
  // degrades to the protective dirty gate (typed token required).
  expandedDirty.value = row.isPruneCandidate
    ? []
    : await window.chorus.getWorktreeDirtyFiles(row.id).catch(() => ['(status unreadable)'])
}

async function confirmAction(row: WorktreeSummary): Promise<void> {
  if (!canConfirm.value) return
  busy.value = true
  actionMessage.value = null
  try {
    // D14: a fresh literal of primitives — nothing store-sourced crosses.
    const res = await window.chorus.removeWorktree({
      worktreeId: row.id,
      ...(deleteBranch.value ? { deleteBranch: true } : {}),
      ...(needsToken.value ? { confirmation: typedPath.value } : {})
    })
    if (!res.ok) {
      actionMessage.value = res.reason
      await refresh()
      if (expandedRow.value === null) {
        // The row is gone (e.g. worktree removed but branch kept) — collapse.
        expandedKey.value = null
      } else if (!expandedRow.value.isPruneCandidate) {
        // Re-read so a dirtied-mid-race row switches to the typed-token UI.
        expandedDirty.value = await window.chorus
          .getWorktreeDirtyFiles(row.id)
          .catch(() => ['(status unreadable)'])
      }
      return
    }
    expandedKey.value = null
    await refresh()
  } catch (err) {
    // A rejected invoke (never a structured {ok:false}) — surface, don't die.
    actionMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

function close(): void {
  emit('close')
}

/** Focus trap copied from LaunchDialog: Tab/Shift-Tab cycle within the
 *  panel; Esc closes. */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close()
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
    <div
      ref="panel"
      class="max-h-[80vh] w-[44rem] overflow-y-auto rounded-lg bg-neutral-900 p-5 shadow-xl"
      role="dialog"
      aria-modal="true"
    >
      <h2 class="text-sm font-semibold text-neutral-200">Worktrees</h2>

      <div v-if="loading" class="mt-4 text-xs text-neutral-500">Loading…</div>
      <div v-else-if="rows.length === 0" class="mt-4 text-xs text-neutral-500">
        No worktrees for this project. Detached worktrees a session leaves behind are listed here.
      </div>

      <ul v-else class="mt-3 space-y-2">
        <li
          v-for="row in rows"
          :key="rowKey(row)"
          class="rounded-md bg-neutral-800/60 px-3 py-2 ring-1 ring-neutral-800"
        >
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-xs text-neutral-200" :title="row.path">
              {{ row.path }}
            </span>
            <span
              v-if="row.isPruneCandidate && !isOrphan(row)"
              class="shrink-0 rounded bg-amber-900/70 px-1.5 py-0.5 text-[10px] text-amber-200"
              title="The directory is gone but git metadata may remain"
            >
              prune candidate
            </span>
            <span
              v-else-if="!isOrphan(row)"
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              :class="row.clean ? 'bg-emerald-900/70 text-emerald-200' : 'bg-red-900/70 text-red-200'"
            >
              {{ row.clean ? 'clean' : `dirty (${row.dirtyCount})` }}
            </span>
            <button
              v-if="!isOrphan(row)"
              class="shrink-0 rounded px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-700"
              :class="row.isPruneCandidate ? 'text-amber-300' : 'text-red-300'"
              @click="toggleExpand(row)"
            >
              {{ row.isPruneCandidate ? 'Prune' : 'Remove' }}
            </button>
          </div>

          <div class="mt-1 flex items-center gap-3 text-[11px] text-neutral-400">
            <span v-if="row.branch" class="max-w-[16rem] truncate text-sky-400" :title="row.branch">
              {{ row.branch }}
            </span>
            <span v-else class="text-neutral-500">no branch</span>
            <span v-if="row.ahead >= 0 && row.behind >= 0">↑{{ row.ahead }} ↓{{ row.behind }}</span>
            <span v-else title="ahead/behind unknown (no recorded base branch)">—</span>
            <span class="text-neutral-500">{{ row.status }}</span>
          </div>

          <div v-if="isOrphan(row)" class="mt-1 text-[11px] text-neutral-500 italic">
            Not a git worktree (no metadata, no record) — never auto-deleted; remove it by hand if
            it is debris.
          </div>

          <!-- inline confirmation region (never window.confirm) -->
          <div
            v-if="expandedKey === rowKey(row)"
            class="mt-2 rounded bg-neutral-900/80 p-2 ring-1 ring-neutral-700"
          >
            <template v-if="row.isPruneCandidate">
              <p class="text-xs text-neutral-300">
                The directory is already gone. Pruning clears this worktree's stale git metadata and
                its record in Chorus.
              </p>
            </template>
            <template v-else-if="expandedDirty.length > 0">
              <p class="text-xs text-neutral-300">
                This worktree has uncommitted work that will be destroyed:
              </p>
              <ul class="mt-1 max-h-28 overflow-y-auto text-[11px] text-red-300">
                <li v-for="f in expandedDirty" :key="f" class="truncate" :title="f">{{ f }}</li>
              </ul>
            </template>
            <template v-else>
              <p class="text-xs text-neutral-300">
                This worktree is clean — no uncommitted work will be lost.
              </p>
            </template>

            <label
              v-if="row.branch"
              class="mt-2 flex items-center gap-2 text-[11px] text-neutral-300 select-none"
            >
              <input v-model="deleteBranch" type="checkbox" class="accent-sky-600" />
              Also delete branch <span class="text-sky-400">{{ row.branch }}</span>
            </label>

            <label v-if="needsToken" class="mt-2 block text-[11px] text-neutral-400">
              Type the worktree path to confirm destroying uncommitted work:
              <input
                v-model="typedPath"
                class="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
                :placeholder="row.path"
              />
            </label>

            <div class="mt-3 flex justify-end gap-2">
              <button class="text-xs text-neutral-400 hover:text-neutral-200" @click="expandedKey = null">
                Cancel
              </button>
              <button
                class="rounded bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-40"
                :disabled="!canConfirm"
                @click="confirmAction(row)"
              >
                {{ row.isPruneCandidate ? 'Prune' : 'Remove worktree' }}
              </button>
            </div>
          </div>
        </li>
      </ul>

      <p v-if="actionMessage" class="mt-3 text-xs text-red-400">{{ actionMessage }}</p>

      <div class="mt-4 flex justify-end">
        <button class="text-sm text-neutral-400 hover:text-neutral-200" @click="close">Close</button>
      </div>
    </div>
  </div>
</template>

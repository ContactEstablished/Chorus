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
  <div class="overlay-scrim overlay-scrim-panel" @keydown="onKeydown">
    <div
      ref="panel"
      class="overlay-panel overlay-panel-dialog wt"
      role="dialog"
      aria-modal="true"
    >
      <h2 class="wt-title">Worktrees</h2>

      <div v-if="loading" class="wt-quiet">Loading…</div>
      <div v-else-if="rows.length === 0" class="wt-quiet">
        No worktrees for this project. Detached worktrees a session leaves behind are listed here.
      </div>

      <ul v-else class="wt-list">
        <li v-for="row in rows" :key="rowKey(row)" class="wt-row">
          <div class="wt-head">
            <span class="wt-path" :title="row.path">
              {{ row.path }}
            </span>
            <span
              v-if="row.isPruneCandidate && !isOrphan(row)"
              class="wt-badge wt-badge-warn"
              title="The directory is gone but git metadata may remain"
            >
              prune candidate
            </span>
            <span
              v-else-if="!isOrphan(row)"
              class="wt-badge"
              :class="row.clean ? 'wt-badge-ok' : 'wt-badge-bad'"
            >
              {{ row.clean ? 'clean' : `dirty (${row.dirtyCount})` }}
            </span>
            <button
              v-if="!isOrphan(row)"
              class="wt-act"
              :class="row.isPruneCandidate ? 'wt-act-warn' : 'wt-act-bad'"
              @click="toggleExpand(row)"
            >
              {{ row.isPruneCandidate ? 'Prune' : 'Remove' }}
            </button>
          </div>

          <div class="wt-meta">
            <span v-if="row.branch" class="wt-branch" :title="row.branch">
              {{ row.branch }}
            </span>
            <span v-else class="wt-dim">no branch</span>
            <span v-if="row.ahead >= 0 && row.behind >= 0">↑{{ row.ahead }} ↓{{ row.behind }}</span>
            <span v-else title="ahead/behind unknown (no recorded base branch)">—</span>
            <span class="wt-dim">{{ row.status }}</span>
          </div>

          <div v-if="isOrphan(row)" class="wt-orphan">
            Not a git worktree (no metadata, no record) — never auto-deleted; remove it by hand if
            it is debris.
          </div>

          <!-- inline confirmation region (never window.confirm) -->
          <div v-if="expandedKey === rowKey(row)" class="wt-confirm">
            <template v-if="row.isPruneCandidate">
              <p class="wt-confirm-text">
                The directory is already gone. Pruning clears this worktree's stale git metadata and
                its record in Chorus.
              </p>
            </template>
            <template v-else-if="expandedDirty.length > 0">
              <p class="wt-confirm-text">
                This worktree has uncommitted work that will be destroyed:
              </p>
              <ul class="wt-dirty">
                <li v-for="f in expandedDirty" :key="f" class="wt-dirty-file" :title="f">{{ f }}</li>
              </ul>
            </template>
            <template v-else>
              <p class="wt-confirm-text">
                This worktree is clean — no uncommitted work will be lost.
              </p>
            </template>

            <label v-if="row.branch" class="wt-check">
              <input v-model="deleteBranch" type="checkbox" class="wt-box" />
              Also delete branch <span class="wt-branch">{{ row.branch }}</span>
            </label>

            <label v-if="needsToken" class="wt-token">
              Type the worktree path to confirm destroying uncommitted work:
              <input v-model="typedPath" class="wt-token-input" :placeholder="row.path" />
            </label>

            <div class="wt-confirm-foot">
              <button class="wt-cancel" @click="expandedKey = null">
                Cancel
              </button>
              <button class="overlay-btn-danger" :disabled="!canConfirm" @click="confirmAction(row)">
                {{ row.isPruneCandidate ? 'Prune' : 'Remove worktree' }}
              </button>
            </div>
          </div>
        </li>
      </ul>

      <p v-if="actionMessage" class="wt-error">{{ actionMessage }}</p>

      <div class="wt-foot">
        <button class="wt-cancel" @click="close">Close</button>
      </div>
    </div>
  </div>
</template>

<style src="../assets/overlays.css"></style>

<style scoped>
/* ⚠ UNMOCKED SURFACE — TOKEN-AND-PRIMITIVE CONFORMANCE ONLY (the milestone
   amendment's declared gap). Nothing here is a redesign: every element sits
   where it sat, in the order it sat, with the same wording. Only class
   attributes changed, which is what `git diff` should show.

   ⚠ StateMarker is deliberately NOT used. Spec §5 says to use it "if a state
   maps cleanly; if none does, leave the existing indicator alone" — and none
   does: clean / dirty / prune-candidate are not running / error / done /
   needs-you, and minting a fifth shape is a design decision, not an
   implementation one. The text badges stay, recoloured onto state tokens.

   ⚠ THE REMOVAL CONFIRMATION IS A GATED DESTRUCTIVE PATH WITH F21 ATTACHED.
   Its logic, its required confirmation token, and every word of its copy are
   untouched here — only the container's colours moved. */
.wt {
  width: 44rem;
  max-height: 80vh;
  padding: 20px;
  overflow-y: auto;
}

.wt-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.wt-quiet {
  margin-top: 16px;
  font-size: 11.5px;
  color: var(--color-text-quiet);
}

.wt-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wt-row {
  border: 1px solid var(--color-border-inset);
  background: var(--color-surface-field);
  border-radius: var(--radius-rail);
  padding: 8px 12px;
}

.wt-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wt-path {
  min-width: 0;
  flex: 1;
  font-size: 11.5px;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wt-badge {
  flex: none;
  border-radius: var(--radius-chip);
  padding: 1px 6px;
  font-size: 10px;
}

.wt-badge-warn {
  background: color-mix(in srgb, var(--color-state-attention) 14%, transparent);
  color: var(--color-state-attention-text);
}

.wt-badge-ok {
  background: color-mix(in srgb, var(--color-state-running) 14%, transparent);
  color: var(--color-state-running-text);
}

.wt-badge-bad {
  background: color-mix(in srgb, var(--color-state-error) 14%, transparent);
  color: var(--color-state-error-text);
}

.wt-act {
  flex: none;
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  padding: 2px 8px;
  font-size: 11.5px;
  cursor: default;
}

.wt-act:hover {
  background: var(--color-surface-icon-hover);
}

.wt-act-warn {
  color: var(--color-state-attention-text);
}

.wt-act-bad {
  color: var(--color-state-error-text);
}

.wt-meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.wt-branch {
  max-width: 16rem;
  color: var(--color-accent-jade);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wt-dim {
  color: var(--color-text-quiet);
}

.wt-orphan {
  margin-top: 4px;
  font-size: 11px;
  font-style: italic;
  color: var(--color-text-quiet);
}

.wt-confirm {
  margin-top: 8px;
  border: 1px solid var(--color-border-inset);
  background: var(--color-surface-well);
  border-radius: var(--radius-icon);
  padding: 8px;
}

.wt-confirm-text {
  font-size: 11.5px;
  color: var(--color-text-body);
}

.wt-dirty {
  margin-top: 4px;
  max-height: 7rem;
  overflow-y: auto;
  font-size: 11px;
  color: var(--color-state-error-text);
}

.wt-dirty-file {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wt-check {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-body);
  user-select: none;
}

.wt-box {
  accent-color: var(--color-accent-jade);
}

.wt-token {
  margin-top: 8px;
  display: block;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.wt-token-input {
  margin-top: 4px;
  width: 100%;
  border: 1px solid var(--color-border-badge);
  background: var(--color-surface-field);
  border-radius: var(--radius-chip);
  padding: 4px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-body);
  outline: none;
}

.wt-token-input:focus {
  border-color: var(--color-accent-jade);
}

.wt-confirm-foot {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  align-items: center;
}

.wt-cancel {
  border: 0;
  background: transparent;
  padding: 0 6px;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  cursor: default;
}

.wt-cancel:hover {
  color: var(--color-text-body);
}

.wt-error {
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--color-state-error-text);
}

.wt-foot {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>

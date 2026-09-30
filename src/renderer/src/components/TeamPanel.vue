<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import { useTeamStore, plainTeamInput, teamValue } from '../stores/team'
import type { TeamIntegration, TeamEvent } from '../../../shared/team'
const TeamReviewDialog = defineAsyncComponent(() => import('./TeamReviewDialog.vue'))
const props = defineProps<{ sessionId: string }>()
const teams = useTeamStore(), projects = useProjectStore(), release = teams.connect()
const selectedId = ref<string | null>(null)
const expanded = ref(false), busy = ref(false), error = ref(''), extraEvents = ref<TeamEvent[]>([])
const clockNow = ref(Date.now()), clockTimer = setInterval(() => { clockNow.value = Date.now() }, 1000)
const run = computed(() => Object.values(teams.runs).find(r => r.leadSessionId === props.sessionId))
const snapshot = computed(() => run.value ? teams.snapshots[run.value.id] : undefined)
const events = computed(() => { const byId = new Map([...(snapshot.value?.events ?? []), ...extraEvents.value].map(e => [e.id, e])); return [...byId.values()].sort((a, b) => a.sequence - b.sequence) })
const outputs = computed(() => { const latest = new Map<string, TeamIntegration>(); for (const i of snapshot.value?.integrations ?? []) if (i.status === 'applied') latest.set(i.taskId, i); return [...latest.values()] })
const selected = computed(() => snapshot.value?.integrations.find(i => i.id === selectedId.value))
const tasks = computed(() => snapshot.value?.tasks ?? [])
const running = computed(() => tasks.value.filter(t => t.status === 'running'))
const blocked = computed(() => tasks.value.filter(t => ['blocked', 'failed', 'needs-revision'].includes(t.status) || (t.status === 'running' && snapshot.value?.attempts.find(a => a.id === t.currentAttemptId)?.blocker)))
const leadReview = computed(() => tasks.value.filter(t => t.status === 'awaiting-review'))
const queued = computed(() => tasks.value.filter(t => t.status === 'queued'))
const headline = computed(() => blocked.value.length ? `${blocked.value.length} tasks need attention` : running.value.length ? `${running.value.length} helpers working` : leadReview.value.length ? `${leadReview.value.length} results waiting for lead review` : queued.value.length ? `${queued.value.length} tasks queued` : 'No helpers are running')
const helperMinutes = computed(() => Math.round((snapshot.value?.attempts ?? []).reduce((sum, a) => sum + (a.startedAt ? Math.max(0, (a.endedAt ? Date.parse(a.endedAt) : clockNow.value) - Date.parse(a.startedAt)) : 0), 0) / 60000))
const completeEnabled = computed(() => snapshot.value && snapshot.value.tasks.every(t => ['completed', 'cancelled'].includes(t.status)) && snapshot.value.integrations.every(i => ['applied', 'rejected'].includes(i.status)))
const archived = computed(() => !!run.value?.finish && (!!run.value.finish.publishedAt || ['cleaned', 'retained'].includes(run.value.finish.status)))
onBeforeUnmount(release)
onBeforeUnmount(() => clearInterval(clockTimer))
watch(() => projects.activeId, id => { if (id) void teams.load(id).catch(e => { error.value = String(e) }) }, { immediate: true })
watch(() => run.value?.id, id => { extraEvents.value = []; selectedId.value = null; if (id) void teams.refresh(id).catch(e => { error.value = String(e) }) }, { immediate: true })
async function moreEvents(): Promise<void> {
  if (!run.value) return
  try { const page = teamValue(await window.chorus.team.snapshot({ runId: run.value.id, afterSequence: events.value.at(-1)?.sequence ?? 0 })); extraEvents.value = [...extraEvents.value, ...page.events].slice(-1000) } catch (e) { error.value = String(e) }
}
async function control(action: 'activate' | 'pause' | 'resume' | 'recover' | 'stop' | 'complete'): Promise<void> {
  if (!run.value || busy.value) return; busy.value = true; error.value = ''
  try { teamValue(await window.chorus.team.control(plainTeamInput({ runId: run.value.id, expectedVersion: run.value.version, action, clientRequestId: crypto.randomUUID() }))) } catch (e) { error.value = String(e) } finally { await teams.refresh(run.value.id).catch(() => {}); busy.value = false }
}
function age(start: string, end?: string | null): string { const seconds = Math.max(0, Math.round(((end ? Date.parse(end) : clockNow.value) - Date.parse(start)) / 1000)); return `${Math.floor(seconds / 60)}m ${seconds % 60}s` }
</script>
<template>
  <section v-if="run" class="team-panel" aria-label="Team session">
    <div class="team-bar">
      <button type="button" :aria-expanded="expanded" @click="expanded = !expanded">Team · {{ run.status }}</button>
      <span class="headline">{{ headline }}</span>
      <span class="muted">{{ tasks.filter(t => t.status === 'completed').length }}/{{ tasks.length }} complete</span>
      <button v-if="outputs.length" class="review-action" @click="selectedId = outputs[0].id">View outputs ({{ outputs.length }})</button>
      <button v-if="blocked.length" @click="expanded = true">{{ blocked.length }} need attention</button>
    </div>
    <p v-if="run.blocker" class="bar-alert" role="alert">{{ run.blocker }}</p>
    <p v-if="run.finish" class="bar-alert" role="status">Final checks / publication: {{ run.finish.status }}<template v-if="run.finish.publishedAt"> · merged into {{ run.destination?.branch }}</template> · {{ run.finish.removedWorktreeIds.length }} workspaces removed<template v-if="run.finish.retainedWorktreeIds.length"> · {{ run.finish.retainedWorktreeIds.length }} retained for inspection</template></p>
    <p v-if="error || teams.errors[run.id]" class="bar-alert" role="alert">{{ error || teams.errors[run.id] }}</p>
    <Teleport to="body"><TeamReviewDialog v-if="selected" :integration="selected" @close="selectedId = null" /></Teleport>
    <div v-if="expanded" class="team-body">
      <p v-if="events.some(e => e.operation === 'lead-context-not-restored')" role="status">A replacement lead started with a retained-task handoff because the previous CLI conversation could not be verified. See the event history for that boundary.</p>
      <p v-if="run.status === 'preparing'">Waiting for the lead’s Team tool handshake. Finish any CLI trust prompt below, then retry activation.</p>
      <div class="team-controls"><button v-if="run.status === 'preparing'" :disabled="busy" @click="control('activate')">Retry activation</button><button v-if="['active', 'preparing'].includes(run.status)" :disabled="busy" @click="control('pause')">Pause</button><button v-if="!archived && ['paused', 'completed', 'recovering', 'blocked'].includes(run.status)" :disabled="busy" @click="control('resume')">Resume</button><button v-if="!archived && ['paused', 'blocked'].includes(run.status)" :disabled="busy" @click="control('recover')">Recover retained work</button><button v-if="!archived && run.status !== 'stopped'" :disabled="busy" @click="control('stop')">Stop</button><button v-if="run.status === 'active'" :disabled="busy || !completeEnabled" @click="control('complete')">{{ run.config.publicationPolicy ? 'Finish team' : 'Complete team' }}</button><button v-if="run.finish?.publishedAt && (run.finish.retainedWorktreeIds.length || run.finish.status !== 'cleaned')" :disabled="busy" @click="control('complete')">Retry cleanup</button><button :disabled="busy" @click="teams.refresh(run.id)">Refresh</button></div>
      <div class="progress-summary"><span>{{ running.length }} working</span><span>{{ queued.length }} queued</span><span>{{ leadReview.length }} waiting for lead review</span><span>{{ outputs.length }} applied outputs</span><span>{{ blocked.length }} need attention</span></div>
      <p class="muted">Elapsed {{ age(run.createdAt, ['stopped', 'completed'].includes(run.status) ? run.updatedAt : null) }} · {{ helperMinutes }} helper-minutes across all attempts (may overlap) · {{ snapshot?.attempts.length ?? 0 }} attempts</p>
      <p v-if="snapshot?.integrations.some(i => i.status === 'approved')" role="status">Approved work is waiting for the lead to apply it. The lead continues automatically; no approval is needed.</p>
      <article v-for="integration in outputs" :key="integration.id" class="approval"><div><strong>{{ tasks.find(t => t.id === integration.taskId)?.command.title ?? 'Prepared result' }}</strong><p class="muted">Applied output · {{ age(integration.updatedAt) }}</p></div><button class="review-action" @click="selectedId = integration.id">View output</button></article>
      <details v-if="blocked.length" open class="blockers"><summary>Needs attention · {{ blocked.length }}</summary><article v-for="task in blocked" :key="task.id"><strong>{{ task.command.title }}</strong><p>{{ task.blocker ?? task.status }}</p><p class="muted">{{ snapshot?.attempts.find(a => a.id === task.currentAttemptId)?.status === 'permission-blocked' ? 'Access was denied. The lead needs to resolve the input or tool access before retrying.' : 'The lead needs to inspect this task before it can continue.' }}</p></article></details>
      <details><summary>All tasks · {{ tasks.length }}</summary>
      <details v-for="task in snapshot?.tasks" :key="task.id"><summary>{{ task.command.title }} · {{ task.status }}</summary><p>{{ task.blocker }}</p><p>Attempts: {{ task.attemptCount }} / 3</p><p v-if="task.attemptCount >= 3 && ['blocked', 'failed', 'needs-revision'].includes(task.status)" role="status">This task has used all three attempts. Ask the lead to explain the blocker before directing a new task.</p><p>Initial queue wait: {{ age(task.createdAt, snapshot?.attempts.find(a => a.taskId === task.id)?.startedAt ?? (task.status === 'queued' ? null : task.updatedAt)) }}</p>
        <div v-for="attempt in snapshot?.attempts.filter(a => a.taskId === task.id)" :key="attempt.id" class="attempt"><strong>Attempt {{ attempt.number }} · {{ attempt.status }}</strong><p>{{ snapshot?.members.find(m => m.id === attempt.memberId)?.label }} · {{ snapshot?.members.find(m => m.id === attempt.memberId)?.model }}</p><p v-if="attempt.startedAt">Execution: {{ age(attempt.startedAt, attempt.endedAt) }}</p><p>{{ attempt.blocker }}</p><details v-if="events.some(e => e.operation === 'helper-activity' && e.payload.attemptId === attempt.id)"><summary>Helper activity (read only)</summary><pre v-for="event in events.filter(e => e.operation === 'helper-activity' && e.payload.attemptId === attempt.id)" :key="event.id">{{ event.payload.text }}{{ event.payload.truncated ? '\n[Activity display reached its 64 KiB limit.]' : '' }}</pre></details><pre v-if="attempt.result">{{ attempt.result.summary }}</pre><p v-if="attempt.artifact">Files: {{ attempt.artifact.manifest.join(', ') }}</p><details><summary>Tests and usage provenance</summary><pre>{{ JSON.stringify({ tests: attempt.result?.tests ?? [], usage: attempt.usage.length ? attempt.usage : 'Unknown' }, null, 2) }}</pre></details></div>
      </details>
      </details>
      <details><summary>Technical history and retained evidence ({{ events.length }} shown)</summary><pre>{{ JSON.stringify(events, null, 2) }}</pre></details>
      <button v-if="(events.at(-1)?.sequence ?? 0) < (snapshot?.lastSequence ?? 0)" @click="moreEvents">Load more technical history</button>
      <details><summary>Team configuration</summary><p>{{ run.config.lead.harness }} · {{ run.config.lead.model }} · Lead integrates automatically · up to {{ run.config.concurrency }} concurrent helpers. Subscription spend and unreported usage are unknown.</p></details>
      <p class="muted">Closing this view detaches it. Stop preserves all worktrees and history. Instructions and corrections go through the lead terminal.</p>
    </div>
  </section>
</template>
<style scoped>
.team-panel{border-bottom:1px solid #45534d;font-size:12px;flex:none}.team-bar,.team-controls{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:5px 9px}.team-body{max-height:35vh;overflow:auto;padding:8px 12px;display:flex;flex-direction:column;gap:10px}button{border:1px solid #54635c;border-radius:4px;padding:4px 8px}button:disabled{opacity:.4}.muted{opacity:.7}.approval,.attempt{border:1px solid #54635c;padding:9px;border-radius:5px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font:11px monospace}dd{overflow-wrap:anywhere}dt{opacity:.65}summary{cursor:pointer}p[role=alert]{color:#ffad9e}
.headline{flex:1;min-width:150px}.review-action{background:#204b3c;border-color:#6aa78f}.bar-alert{padding:6px 12px;margin:0}.progress-summary{display:flex;flex-wrap:wrap;gap:15px;color:#b6c6d2}.approval{display:flex;align-items:center;justify-content:space-between;gap:14px}.approval p{margin-top:6px}.blockers{border-left:3px solid #dbac68;padding:8px 12px}.blockers article{padding:10px 0}.blockers p{margin-top:5px}.team-body>details>details{padding:8px 0}.team-panel button:focus-visible,summary:focus-visible{outline:2px solid #8ecfb8;outline-offset:3px}
</style>

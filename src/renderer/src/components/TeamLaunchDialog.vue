<script setup lang="ts">
import { focusedTeamClaudeVersion } from '../../../shared/team'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { TeamCapabilities, TeamPreset, TeamRunConfig } from '../../../shared/team'
import type { AgentKind, AttachResponse } from '../../../shared/ipc'
import { plainTeamInput, teamValue, useTeamStore } from '../stores/team'
import TeamMemberEditor from './TeamMemberEditor.vue'
const showMembers = ref(false)
const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ cancel: []; launched: [payload: { agent: AgentKind; snapshot: AttachResponse }] }>()
const teams = useTeamStore(), release = teams.connect()
const capabilities = ref<TeamCapabilities | null>(null), presets = ref<TeamPreset[]>([])
const leadKey = ref('claude'), helperKeys = ref<string[]>(['codex', 'codex']), baseRevision = ref('HEAD')
const concurrency = ref(2), minutes = ref(30)
const publicationPolicy = ref<'auto-clean' | 'retain'>('auto-clean'), verificationProfile = ref<'npm-project' | 'node-test'>('npm-project')
const leadContext = ref<'focused' | 'standard'>('focused')
const error = ref(''), busy = ref(false), loading = ref(true), presetLabel = ref(''), presetId = ref('')
let alive = true, requestId = crypto.randomUUID(), pendingConfig: TeamRunConfig | null = null
const leads = computed(() => capabilities.value?.options.filter(o => o.lead) ?? [])
const helpers = computed(() => capabilities.value?.options.filter(o => !['claude-opus', 'codex-sol'].includes(o.key)) ?? [])
const history = computed(() => Object.values(teams.runs).filter(r => r.projectId === props.projectId).reverse())
const unavailable = computed(() => Object.entries(teams.unavailable).filter(([, value]) => value.projectId === props.projectId).map(([id, value]) => ({ id, ...value })))
onBeforeUnmount(() => { alive = false; release() })
onMounted(async () => { try { const [caps, saved] = await Promise.all([window.chorus.team.capabilities({ projectId: props.projectId }), window.chorus.team.presetList({ projectId: props.projectId }), teams.load(props.projectId)]); const available = teamValue(caps); capabilities.value = available; presets.value = teamValue(saved); leadKey.value = leads.value.find(o => o.enabled)?.key ?? 'claude'; helperKeys.value = Array(2).fill(available.options.find(o => o.enabled && o.member.model === 'deepseek/deepseek-v4.1-flash')?.key ?? available.options.find(o => o.enabled && !o.lead)?.key ?? 'codex') } catch (e) { error.value = String(e) } finally { loading.value = false } })
function config(): TeamRunConfig {
  const member = (key: string) => { const option = capabilities.value?.options.find(o => o.key === key); if (!option?.enabled) throw Error(option?.reason ?? 'Choose an available model.'); return { ...plainTeamInput(option.member), id: crypto.randomUUID() } }
  if (!baseRevision.value.trim() || !Number.isInteger(concurrency.value) || concurrency.value < 1 || concurrency.value > 8 || !Number.isInteger(minutes.value) || minutes.value < 5 || minutes.value > 240) throw Error('Enter a committed base, concurrency 1–8, and timeout 5–240 minutes.')
  const lead = member(leadKey.value)
  return { schemaVersion: 1, baseRevision: baseRevision.value, lead, helpers: helperKeys.value.map((key, index) => { const helper = member(key); return { ...helper, ...(key === 'codex' ? { effort: null } : {}), label: helper.label.slice(0, 85) + ' - helper ' + (index + 1) } }), concurrency: concurrency.value, executionMinutes: minutes.value, integrationPolicy: 'lead-integrates', publicationPolicy: publicationPolicy.value, verificationProfile: verificationProfile.value, ...(lead.harness === 'claude' && focusedTeamClaudeVersion(lead.installedVersion) ? { leadContext: leadContext.value } : {}) }
}
async function membersClosed(selectedId?: string): Promise<void> {
  showMembers.value = false; loading.value = true; error.value = ''
  try {
    capabilities.value = teamValue(await window.chorus.team.capabilities({ projectId: props.projectId }))
    helperKeys.value = helperKeys.value.map(key => capabilities.value!.options.some(o => o.key === key) ? key : '')
    if (selectedId && !helperKeys.value.includes(selectedId)) {
      if (helperKeys.value.length < 16) helperKeys.value.push(selectedId)
      else error.value = 'The roster already has 16 helpers. Remove one before adding this member.'
    }
  } catch (e) { error.value = String(e) } finally { loading.value = false }
}
function usePreset(): void {
  const preset = presets.value.find(p => p.id === presetId.value); if (!preset) return
    const match = (member: TeamRunConfig['lead']) => capabilities.value?.options.find(o => o.member.harness === member.harness && o.member.model === member.model && o.member.authMode === member.authMode && o.member.credentialProfileId === member.credentialProfileId && o.member.installedVersion === member.installedVersion && o.member.profileId === member.profileId && (o.member.instructions ?? '') === (member.instructions ?? ''))?.key ?? ''
  leadKey.value = match(preset.config.lead); helperKeys.value = preset.config.helpers.map(match); baseRevision.value = preset.config.baseRevision; concurrency.value = preset.config.concurrency; minutes.value = preset.config.executionMinutes; presetLabel.value = preset.label; publicationPolicy.value = preset.config.publicationPolicy ?? 'retain'; verificationProfile.value = preset.config.verificationProfile ?? 'node-test'
  leadContext.value = preset.config.leadContext ?? 'standard'
}
async function savePreset(): Promise<void> {
  error.value = ''; try { const preset = presets.value.find(p => p.id === presetId.value); presets.value = teamValue(await window.chorus.team.presetSave(plainTeamInput({ projectId: props.projectId, ...(preset ? { id: preset.id } : {}), expectedVersion: preset?.version ?? null, label: presetLabel.value, config: config() }))) } catch (e) { error.value = String(e) }
}
async function deletePreset(): Promise<void> {
  const preset = presets.value.find(p => p.id === presetId.value); if (!preset) return
  try { presets.value = teamValue(await window.chorus.team.presetDelete({ projectId: props.projectId, id: preset.id, expectedVersion: preset.version })); presetId.value = ''; presetLabel.value = '' } catch (e) { error.value = String(e) }
}
async function openRun(id: string): Promise<void> {
  const snapshot = await teams.refresh(id), sessionId = snapshot.run.leadSessionId
  if (!sessionId) throw Error(snapshot.run.blocker ?? 'The lead is still preparing. Refresh this team shortly.')
  const attached = await window.chorus.attachSession({ sessionId, agent: snapshot.run.config.lead.harness as AgentKind })
  emit('launched', { agent: snapshot.run.config.lead.harness as AgentKind, snapshot: attached })
}
async function launch(): Promise<void> {
  if (busy.value) return; busy.value = true; error.value = ''
  try {
    // A retry after transport failure keeps its original immutable payload and request ID.
    pendingConfig ??= config()
    const ack = teamValue(await window.chorus.team.launch(plainTeamInput({ projectId: props.projectId, clientRequestId: requestId, config: pendingConfig })))
    const id = String(ack.runId), deadline = Date.now() + 60000
    while (alive && Date.now() < deadline) {
      const snapshot = await teams.refresh(id)
      if (snapshot.run.status === 'blocked') throw Error(snapshot.run.blocker ?? 'Team launch is blocked.')
      if (snapshot.run.leadSessionId && snapshot.events.some(e => e.operation === 'lead-started')) { await openRun(id); return }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    error.value = 'The team is retained below. Open its lead to finish CLI trust prompts.'
    requestId = crypto.randomUUID(); pendingConfig = null
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function reopen(id: string): Promise<void> { try { await openRun(id) } catch (e) { error.value = String(e) } }
</script>

<template>
  <TeamMemberEditor v-if="showMembers" @close="membersClosed" />
  <div v-else class="overlay-scrim overlay-scrim-dialog" @keydown.esc.stop="!busy && emit('cancel')">
    <section class="overlay-panel team-launch" role="dialog" aria-modal="true" aria-labelledby="team-launch-title">
      <header><h2 id="team-launch-title">Team session</h2><button type="button" :disabled="busy" @click="emit('cancel')">Back</button></header>
      <p>One lead plans and reviews; independent helpers implement in isolated worktrees.</p>
      <p v-if="loading" role="status">Checking installed model capabilities…</p>
      <template v-else>
        <p class="muted">{{ capabilities?.accountScope }}</p>
        <button type="button" :disabled="busy" @click="showMembers = true">Manage team members</button>
        <label>Lead<select v-model="leadKey" :disabled="busy"><option v-for="o in leads" :key="o.key" :value="o.key" :disabled="!o.enabled">{{ o.label }}{{ o.enabled ? '' : ' — unavailable' }}</option></select></label>
        <label v-if="capabilities?.options.find(o => o.key === leadKey)?.member.harness === 'claude'">Lead context<select v-model="leadContext" :disabled="busy"><option value="focused">Team tools and project memory</option><option value="standard">Include configured CLI skills and servers</option></select></label>
        <p v-if="leadContext === 'focused' && capabilities?.options.find(o => o.key === leadKey)?.member.harness === 'claude'" class="muted">Focused context skips unrelated skills and MCP servers to reduce lead context. CLI permissions, settings and hooks still apply.</p>
        <fieldset :disabled="busy"><legend>Helpers (1–16)</legend><p class="muted">Two helpers can work in parallel on separate deliverables. The lead prepares shared inputs, assigns separate files, and combines the finished work.</p>
          <div v-for="(_, i) in helperKeys" :key="i" class="row"><select v-model="helperKeys[i]" :aria-label="`Helper ${i + 1}`"><option value="" disabled>Choose a helper — previous selection unavailable</option><option v-for="o in helpers" :key="o.key" :value="o.key" :disabled="!o.enabled">{{ o.label }}{{ o.enabled ? '' : ' — unavailable' }}</option></select><button type="button" :disabled="helperKeys.length === 1" @click="helperKeys.splice(i, 1)">Remove</button></div>
          <button type="button" :disabled="helperKeys.length >= 16" @click="helperKeys.push(helperKeys[0] ?? '')">Add helper</button>
        </fieldset>
        <details v-if="capabilities?.options.some(o => !o.enabled)"><summary>Unavailable options</summary><p v-for="o in capabilities?.options.filter(o => !o.enabled)" :key="o.key">{{ o.label }}: {{ o.reason }}</p></details>
        <div class="row"><label>Committed base<input v-model="baseRevision" :disabled="busy" /></label><label>Concurrent helpers<input v-model.number="concurrency" type="number" min="1" max="8" :disabled="busy" /></label><label>Timeout (minutes)<input v-model.number="minutes" type="number" min="5" max="240" :disabled="busy" /></label></div>
        <p>The lead reviews and applies helper work automatically. Review finished outputs and request changes in the lead terminal.</p>
        <div class="row"><label>Finish<select v-model="publicationPolicy" :disabled="busy"><option value="auto-clean">Merge into the current branch when clean, then clean up</option><option value="retain">Keep verified output on the Team branch</option></select></label><label>Project checks<select v-model="verificationProfile" :disabled="busy"><option value="npm-project">npm tests, typecheck and build</option><option value="node-test">Node tests only</option></select></label></div>
        <p v-if="publicationPolicy === 'auto-clean'" class="muted">The destination branch is recorded at launch. A dirty or changed checkout retains the verified result for you to resolve.</p>
        <details><summary>Launch diagnostics</summary><p v-for="o in capabilities?.options" :key="o.key">{{ o.label }} · {{ o.member.installedVersion }}: {{ o.reason }}</p></details>
        <p class="muted">Maximum three attempts per task. Subscription spend is unknown.</p>
        <details><summary>Reusable team presets</summary><select v-model="presetId" aria-label="Team preset" @change="usePreset"><option value="">New preset</option><option v-for="p in presets" :key="p.id" :value="p.id">{{ p.label }} · v{{ p.version }}</option></select><input v-model="presetLabel" aria-label="Preset name" placeholder="Preset name" /><button :disabled="busy || !presetLabel.trim()" @click="savePreset">Save preset</button><button :disabled="busy || !presetId" @click="deletePreset">Delete preset</button></details>
        <button type="button" :disabled="busy || !capabilities?.options.some(o => o.lead && o.enabled)" @click="launch">{{ busy ? 'Preparing lead…' : 'Launch team' }}</button>
      </template>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-for="record in unavailable" :key="record.id" role="alert" class="error">Unavailable team {{ record.id }}: {{ record.reason }}</p>
      <details v-if="history.length"><summary>Existing teams ({{ history.length }})</summary><div v-for="run in history" :key="run.id" class="row"><span>{{ run.config.lead.label }} · {{ run.status }} · {{ run.createdAt }}</span><button :disabled="!run.leadSessionId || busy" @click="reopen(run.id)">Open lead</button></div></details>
    </section>
  </div>
</template>
<style scoped>
.team-launch{width:min(780px,94vw);max-height:88vh;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:12px}header,.row{display:flex;gap:10px;align-items:center}header{justify-content:space-between}h2{font-size:18px}label{display:flex;flex-direction:column;gap:5px;flex:1}select,input{min-width:0;width:100%;padding:7px;background:var(--color-bg-secondary,#202226);color:inherit;border:1px solid #555;border-radius:5px}.row select{flex:1}button{padding:7px 11px;border:1px solid #555;border-radius:5px}button:disabled{opacity:.45}fieldset{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid #555}.muted{opacity:.7;font-size:12px}.error{color:#ff9c9c}details{font-size:12px}summary{cursor:pointer}
</style>

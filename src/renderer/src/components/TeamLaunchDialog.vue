<script setup lang="ts">
import { defaultTeamHelperModel, normalizeTeamModel } from '../../../shared/teamProfiles'
import { focusedTeamClaudeVersion } from '../../../shared/team'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TeamCapabilities, TeamPreset, TeamRunConfig } from '../../../shared/team'
import type { AgentKind, AttachResponse } from '../../../shared/ipc'
import { plainTeamInput, teamValue, useTeamStore } from '../stores/team'
import { teamPreparationMessage, waitForTeamLead } from '../stores/teamLaunch'
import TeamMemberEditor from './TeamMemberEditor.vue'
import HelperTierSelect from './routing/HelperTierSelect.vue'
import { routingTeamKey, useRoutingTeamStore, type RoutingTeamRankInput } from '../stores/routingTeam'
import { DEFAULT_ROUTING_SETTINGS, type RoutingLaunchChoice, type RoutingLaunchTier } from '../../../shared/routing'
import {
  helperChoiceView, helperDefaultChoice, helperRoutingEligibility, helperRoutingWanted, helperTierSelectLabel, helperTierSelectView,
  helperTierToSend, launchTierViews, routingHelperCaption, routingUnavailableText, type HelperTierSelectView
} from '../../../shared/routingView'
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
const pendingRunId = ref<string | null>(null), launchMessage = ref(''), stoppingRunId = ref<string | null>(null)
let alive = true, requestId = crypto.randomUUID(), pendingConfig: TeamRunConfig | null = null
const leads = computed(() => capabilities.value?.options.filter(o => o.lead) ?? [])
const helpers = computed(() => capabilities.value?.options.filter(o => !['claude-opus', 'codex-sol'].includes(o.key)).map(o => ({ ...o, enabled: o.helperEnabled ?? o.enabled, reason: o.helperReason ?? o.reason })) ?? [])
const history = computed(() => Object.values(teams.runs).filter(r => r.projectId === props.projectId).reverse())
const unavailable = computed(() => Object.entries(teams.unavailable).filter(([, value]) => value.projectId === props.projectId).map(([id, value]) => ({ id, ...value })))
onBeforeUnmount(() => { alive = false; release() })
/* ── Model Routing 4b-3: the routing tier of each OpenCode helper slot ──
 * ⚠ MAIN DECIDES WHAT A TIER MEANS (K2). A slot sends only a tier NAME,
 * `routingTier`, on its member; `team:launch` checks it, and main resolves it
 * again before EVERY attempt on the numbers it holds then (MR-D32). Eligibility
 * is mirrored (K4) only to decide whether a slot shows a dropdown.
 * ⚠ NO REFRESH HERE (K11, Q2): ranking is free; Settings → Model routing refreshes.
 * ⚠ helperTiers IS INDEX-ALIGNED WITH helperKeys (C12): every handler that
 * pushes, splices or replaces one does the same to the other. */
const routingTeam = useRoutingTeamStore()
routingTeam.reset()
const helperTiers = ref<RoutingLaunchChoice[]>(['default', 'default'])
const helperOption = (key: string) => helpers.value.find(o => o.key === key)
/** K10: a slot whose option is chosen starts on Nitro for the `:nitro` model, else on OpenRouter default. */
const helperTierDefault = (key: string): RoutingLaunchChoice => helperDefaultChoice(helperOption(key)?.member.model ?? '')
function resetHelperTier(index: number, key: string): void { helperTiers.value[index] = helperTierDefault(key) }
function chooseHelperTier(index: number, choice: RoutingLaunchChoice): void { helperTiers.value[index] = choice }
function addHelper(): void { const key = helperKeys.value[0] ?? ''; helperKeys.value.push(key); helperTiers.value.push(helperTierDefault(key)) }
function removeHelper(index: number): void { helperKeys.value.splice(index, 1); helperTiers.value.splice(index, 1) }
interface HelperSlotRouting { wanted: boolean; input: RoutingTeamRankInput | null; busy: boolean; view: HelperTierSelectView | null; tier: RoutingLaunchTier | null; caption: string | null }
const routingSettings = computed(() => routingTeam.settings ?? DEFAULT_ROUTING_SETTINGS)
const helperSlots = computed(() => helperKeys.value.map((key, index): HelperSlotRouting => {
  const member = helperOption(key)?.member ?? null
  const wanted = member !== null && helperRoutingWanted(member)
  const none: HelperSlotRouting = { wanted, input: null, busy: false, view: null, tier: null, caption: null }
  if (member === null || !wanted || routingTeam.loadError !== null) return none
  if (!routingTeam.loaded) return { ...none, busy: true }
  const eligibility = helperRoutingEligibility({ harness: member.harness, authMode: member.authMode, credentialProfileId: member.credentialProfileId, model: normalizeTeamModel(member.model), credentials: routingTeam.credentials, models: routingTeam.models })
  if (!eligibility.eligible || eligibility.baseModel === null || member.credentialProfileId === null) return none
  const input: RoutingTeamRankInput = { model: eligibility.baseModel, effort: member.effort, credentialProfileId: member.credentialProfileId }
  const entry = routingTeam.results[routingTeamKey(input)]
  const busy = entry === undefined || entry.loading
  const views = launchTierViews(entry?.tiers ?? null, routingSettings.value)
  const choice = helperChoiceView({ stored: helperTiers.value[index] ?? null, model: member.model, views })
  const error = entry !== undefined && entry.error !== null && entry.error.code !== 'NO_SNAPSHOT' ? entry.error.message : null
  const view = helperTierSelectView({ views, choice, busy, error })
  return { wanted, input, busy, view, tier: busy ? null : helperTierToSend(true, view.selected), caption: routingHelperCaption(member.effort) }
}))
/** C12: Launch and Save preset wait for main's free answers for every slot that wants routing. */
const routingBusy = computed(() => helperSlots.value.some(s => s.busy))
/** K11: the note under the helpers, once per distinct effort among the slots that show a dropdown. */
const helperCaptions = computed(() => [...new Set(helperSlots.value.flatMap(s => s.view !== null && s.caption !== null ? [s.caption] : []))])
/** C12: a load failure hides every dropdown and says so once; the helpers then go unrouted. */
const routingUnavailable = computed(() => routingTeam.loadError !== null && helperSlots.value.some(s => s.wanted) ? routingUnavailableText(routingTeam.loadError.message) : null)
// C11: the three free reads, once per open, as soon as a slot wants routing.
watch(() => helperSlots.value.some(s => s.wanted), wanted => { if (wanted && !routingTeam.loaded && !routingTeam.loading && routingTeam.loadError === null) void routingTeam.load() }, { immediate: true })
// K11: one free ranking per distinct (credential, base model, effort) per open; slots that share it share the answer.
watch(() => helperSlots.value.flatMap(s => s.input !== null ? [routingTeamKey(s.input)] : []).join(' '), () => {
  for (const slot of helperSlots.value) if (slot.input !== null && routingTeam.results[routingTeamKey(slot.input)] === undefined) void routingTeam.rank(slot.input)
}, { immediate: true })
onMounted(async () => { try { const [caps, saved] = await Promise.all([window.chorus.team.capabilities({ projectId: props.projectId }), window.chorus.team.presetList({ projectId: props.projectId }), teams.load(props.projectId)]); const available = teamValue(caps); capabilities.value = available; presets.value = teamValue(saved); leadKey.value = leads.value.find(o => o.enabled)?.key ?? 'claude'; helperKeys.value = Array(2).fill(available.options.find(o => o.enabled && o.member.model === defaultTeamHelperModel)?.key ?? available.options.find(o => o.enabled && !o.lead)?.key ?? 'codex'); helperTiers.value = helperKeys.value.map(helperTierDefault) } catch (e) { error.value = String(e) } finally { loading.value = false } })
function config(): TeamRunConfig {
  const member = (key: string, helper = false) => { const option = (helper ? helpers.value : leads.value).find(o => o.key === key); if (!option?.enabled) throw Error(option?.reason ?? 'Choose an available model.'); return { ...plainTeamInput(option.member), id: crypto.randomUUID() } }
  if (!baseRevision.value.trim() || !Number.isInteger(concurrency.value) || concurrency.value < 1 || concurrency.value > 8 || !Number.isInteger(minutes.value) || minutes.value < 5 || minutes.value > 240) throw Error('Enter a committed base, concurrency 1–8, and timeout 5–240 minutes.')
  const lead = member(leadKey.value)
  return { schemaVersion: 1, baseRevision: baseRevision.value, lead, helpers: helperKeys.value.map((key, index) => { const helper = member(key, true), tier = helperSlots.value[index]?.tier ?? null; return { ...helper, ...(key === 'codex' ? { effort: null } : {}), label: helper.label.slice(0, 85) + ' - helper ' + (index + 1), ...(tier ? { routingTier: tier } : {}) } }), concurrency: concurrency.value, executionMinutes: minutes.value, integrationPolicy: 'lead-integrates', publicationPolicy: publicationPolicy.value, verificationProfile: verificationProfile.value, ...(lead.harness === 'claude' && focusedTeamClaudeVersion(lead.installedVersion) ? { leadContext: leadContext.value } : {}) }
}
async function membersClosed(selectedId?: string): Promise<void> {
  showMembers.value = false; loading.value = true; error.value = ''
  try {
    capabilities.value = teamValue(await window.chorus.team.capabilities({ projectId: props.projectId }))
    helperKeys.value = helperKeys.value.map(key => capabilities.value!.options.some(o => o.key === key) ? key : '')
    if (selectedId && !helperKeys.value.includes(selectedId)) {
      if (helperKeys.value.length < 16) { helperKeys.value.push(selectedId); helperTiers.value.push(helperTierDefault(selectedId)) } // 4b-3 (K10)
      else error.value = 'The roster already has 16 helpers. Remove one before adding this member.'
    }
  } catch (e) { error.value = String(e) } finally { loading.value = false }
}
function usePreset(): void {
  const preset = presets.value.find(p => p.id === presetId.value); if (!preset) return
    const match = (member: TeamRunConfig['lead']) => capabilities.value?.options.find(o => o.member.harness === member.harness && o.member.model === member.model && o.member.authMode === member.authMode && o.member.credentialProfileId === member.credentialProfileId && o.member.installedVersion === member.installedVersion && o.member.profileId === member.profileId && (o.member.instructions ?? '') === (member.instructions ?? ''))?.key ?? ''
  leadKey.value = match(preset.config.lead); helperKeys.value = preset.config.helpers.map(match); baseRevision.value = preset.config.baseRevision; concurrency.value = preset.config.concurrency; minutes.value = preset.config.executionMinutes; presetLabel.value = preset.label; publicationPolicy.value = preset.config.publicationPolicy ?? 'retain'; verificationProfile.value = preset.config.verificationProfile ?? 'node-test'
  leadContext.value = preset.config.leadContext ?? 'standard'
  helperTiers.value = preset.config.helpers.map(helper => helper.routingTier ?? 'default') // 4b-3 (K10, C13): restored per index, after the keys; none = OpenRouter default
}
async function savePreset(): Promise<void> {
  if (routingBusy.value) return // 4b-3 (C12): a preset is never saved before main's tiers arrive
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
async function stopRun(id: string): Promise<void> {
  if (stoppingRunId.value) return
  stoppingRunId.value = id; error.value = ''
  try {
    const snapshot = await teams.refresh(id)
    teamValue(await window.chorus.team.control({ runId: id, expectedVersion: snapshot.run.version, action: 'stop', clientRequestId: crypto.randomUUID() }))
    await teams.refresh(id)
  } catch (e) { error.value = String(e) } finally { stoppingRunId.value = null }
}
async function launch(): Promise<void> {
  if (routingBusy.value) return // 4b-3 (C12): a team is never launched before main's tiers arrive
  if (busy.value) return; busy.value = true; error.value = ''; launchMessage.value = 'Preparing the isolated workspace…'
  try {
    // A retry after transport failure keeps its original immutable payload and request ID.
    pendingConfig ??= config()
    const ack = teamValue(await window.chorus.team.launch(plainTeamInput({ projectId: props.projectId, clientRequestId: requestId, config: pendingConfig })))
    const id = String(ack.runId)
    pendingRunId.value = id
    // Once creation is acknowledged, a later new launch gets a new request.
    // Only an uncertain transport failure reuses the original immutable payload.
    requestId = crypto.randomUUID(); pendingConfig = null
    if (await waitForTeamLead({ runId: id, refresh: (runId, after) => teams.refresh(runId, after), alive: () => alive,
      progress: (_snapshot, message) => { launchMessage.value = message }, delay: () => new Promise(resolve => setTimeout(resolve, 500)) })) await openRun(id)
    else if (alive) launchMessage.value = 'Team preparation stopped. Its workspace and history are retained.'
  } catch (e) { launchMessage.value = ''; error.value = String(e) } finally { busy.value = false; pendingRunId.value = null }
}
async function reopen(id: string): Promise<void> { try { await openRun(id) } catch (e) { error.value = String(e) } }
</script>

<template>
  <TeamMemberEditor v-if="showMembers" @close="membersClosed" />
  <div v-else class="overlay-scrim overlay-scrim-dialog" @keydown.esc.stop="emit('cancel')">
    <section class="overlay-panel team-launch" role="dialog" aria-modal="true" aria-labelledby="team-launch-title">
      <header><h2 id="team-launch-title">Team session</h2><button type="button" @click="emit('cancel')">Back</button></header>
      <p>One lead plans and reviews; independent helpers implement in isolated worktrees.</p>
      <p v-if="loading" role="status">Checking installed model capabilities…</p>
      <template v-else>
        <p class="muted">{{ capabilities?.accountScope }}</p>
        <button type="button" :disabled="busy" @click="showMembers = true">Manage team members</button>
        <label>Lead<select v-model="leadKey" :disabled="busy"><option v-for="o in leads" :key="o.key" :value="o.key" :disabled="!o.enabled">{{ o.label }}{{ o.enabled ? '' : ' — unavailable' }}</option></select></label>
        <label v-if="capabilities?.options.find(o => o.key === leadKey)?.member.harness === 'claude'">Lead context<select v-model="leadContext" :disabled="busy"><option value="focused">Team tools and project memory</option><option value="standard">Include configured CLI skills and servers</option></select></label>
        <p v-if="leadContext === 'focused' && capabilities?.options.find(o => o.key === leadKey)?.member.harness === 'claude'" class="muted">Focused context skips unrelated skills and MCP servers to reduce lead context. CLI permissions, settings and hooks still apply.</p>
        <fieldset :disabled="busy" :data-routing-helpers-busy="String(routingBusy)"><legend>Helpers (1–16)</legend><p class="muted">Two helpers can work in parallel on separate deliverables. The lead prepares shared inputs, assigns separate files, and combines the finished work.</p>
          <div v-for="(_, i) in helperKeys" :key="i" class="row"><select v-model="helperKeys[i]" :aria-label="`Helper ${i + 1}`" @change="resetHelperTier(i, ($event.target as HTMLSelectElement).value)"><option value="" disabled>Choose a helper — previous selection unavailable</option><option v-for="o in helpers" :key="o.key" :value="o.key" :disabled="!o.enabled">{{ o.label }}{{ o.enabled ? '' : ' — unavailable' }}</option></select><HelperTierSelect v-if="helperSlots[i]?.view" :view="helperSlots[i]!.view!" :label="helperTierSelectLabel(i)" @select="choice => chooseHelperTier(i, choice)" /><button type="button" :disabled="helperKeys.length === 1" @click="removeHelper(i)">Remove</button></div>
          <p v-for="caption in helperCaptions" :key="caption" class="muted" data-routing-helper-caption>{{ caption }}</p>
          <p v-if="routingUnavailable !== null" class="error" data-routing-helper-unavailable>{{ routingUnavailable }}</p>
          <button type="button" :disabled="helperKeys.length >= 16" @click="addHelper()">Add helper</button>
        </fieldset>
        <details v-if="capabilities?.options.some(o => !o.enabled)"><summary>Unavailable options</summary><p v-for="o in capabilities?.options.filter(o => !o.enabled)" :key="o.key">{{ o.label }}: {{ o.reason }}</p></details>
        <div class="row"><label>Committed base<input v-model="baseRevision" :disabled="busy" /></label><label>Concurrent helpers<input v-model.number="concurrency" type="number" min="1" max="8" :disabled="busy" /></label><label>Timeout (minutes)<input v-model.number="minutes" type="number" min="5" max="240" :disabled="busy" /></label></div>
        <p>The lead reviews and applies helper work automatically. Review finished outputs and request changes in the lead terminal.</p>
        <div class="row"><label>Finish<select v-model="publicationPolicy" :disabled="busy"><option value="auto-clean">Merge into the current branch when clean, then clean up</option><option value="retain">Keep verified output on the Team branch</option></select></label><label>Project checks<select v-model="verificationProfile" :disabled="busy"><option value="npm-project">npm tests, typecheck and build</option><option value="node-test">Node tests only</option></select></label></div>
        <p v-if="publicationPolicy === 'auto-clean'" class="muted">The destination branch is recorded at launch. A dirty or changed checkout retains the verified result for you to resolve.</p>
        <details><summary>Launch diagnostics</summary><p v-for="o in capabilities?.options" :key="o.key">{{ o.label }} · {{ o.member.installedVersion }}: {{ o.reason }}</p></details>
        <p class="muted">Maximum three attempts per task. Subscription spend is unknown.</p>
        <details><summary>Reusable team presets</summary><select v-model="presetId" aria-label="Team preset" @change="usePreset"><option value="">New preset</option><option v-for="p in presets" :key="p.id" :value="p.id">{{ p.label }} · v{{ p.version }}</option></select><input v-model="presetLabel" aria-label="Preset name" placeholder="Preset name" /><button :disabled="busy || routingBusy || !presetLabel.trim()" @click="savePreset">Save preset</button><button :disabled="busy || !presetId" @click="deletePreset">Delete preset</button></details>
        <button type="button" :disabled="busy || routingBusy || !capabilities?.options.some(o => o.lead && o.enabled)" @click="launch">{{ busy ? 'Preparing lead…' : 'Launch team' }}</button>
        <p v-if="launchMessage" role="status">{{ launchMessage }}</p>
        <button v-if="pendingRunId" type="button" :disabled="!!stoppingRunId" @click="stopRun(pendingRunId)">{{ stoppingRunId ? 'Stopping…' : 'Stop preparation' }}</button>
      </template>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-for="record in unavailable" :key="record.id" role="alert" class="error">Unavailable team {{ record.id }}: {{ record.reason }}</p>
      <details v-if="history.length"><summary>Existing teams ({{ history.length }})</summary><div v-for="run in history" :key="run.id"><div class="row"><span>{{ run.config.lead.label }} · {{ run.status }} · {{ run.createdAt }}</span><button :disabled="!run.leadSessionId || busy" @click="reopen(run.id)">Open lead</button><button v-if="run.status !== 'stopped' && run.status !== 'completed'" :disabled="!!stoppingRunId" @click="stopRun(run.id)">{{ stoppingRunId === run.id ? 'Stopping…' : 'Stop' }}</button></div><p v-if="run.blocker" role="alert" class="error">{{ run.blocker }}</p><p v-else-if="run.status === 'preparing' && !run.leadSessionId" role="status">{{ teams.snapshots[run.id] ? teamPreparationMessage(teams.snapshots[run.id]) : 'Preparing the isolated workspace. The lead terminal is not available yet.' }}</p></div></details>
    </section>
  </div>
</template>
<style scoped>
.team-launch{width:min(780px,94vw);max-height:88vh;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:12px}header,.row{display:flex;gap:10px;align-items:center}header{justify-content:space-between}h2{font-size:18px}label{display:flex;flex-direction:column;gap:5px;flex:1}select,input{min-width:0;width:100%;padding:7px;background:var(--color-bg-secondary,#202226);color:inherit;border:1px solid #555;border-radius:5px}.row select{flex:1}button{padding:7px 11px;border:1px solid #555;border-radius:5px}button:disabled{opacity:.45}fieldset{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid #555}.muted{opacity:.7;font-size:12px}.error{color:#ff9c9c}details{font-size:12px}summary{cursor:pointer}
</style>

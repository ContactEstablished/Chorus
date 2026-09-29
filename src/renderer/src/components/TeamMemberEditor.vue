<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { TeamMemberProfile, TeamMemberProfileList } from '../../../shared/teamProfiles'
import { teamValue } from '../stores/team'
const emit = defineEmits<{ close: [selectedId?: string] }>()
const data = ref<TeamMemberProfileList>({ profiles: [], credentials: [] })
const loading = ref(true), busy = ref(false), error = ref(''), notice = ref(''), editing = ref(false)
const current = ref<TeamMemberProfile | null>(null), label = ref(''), model = ref(''), instructions = ref('')
const credentialMode = ref<'saved' | 'new'>('new'), credentialId = ref(''), apiKey = ref(''), deleteId = ref<string | null>(null)
onBeforeUnmount(() => { apiKey.value = '' })
watch(credentialMode, () => { apiKey.value = '' })
onMounted(async () => {
  try { data.value = teamValue(await window.chorus.team.memberList({})); if (!data.value.profiles.length) edit() }
  catch (e) { error.value = String(e) } finally { loading.value = false }
})
function edit(member?: TeamMemberProfile): void {
  current.value = member ? { ...member } : null
  label.value = member?.label ?? ''; model.value = member?.model ?? ''; instructions.value = member?.instructions ?? ''
  credentialId.value = member?.credentialProfileId ?? data.value.credentials.find(c => c.available)?.id ?? ''
  credentialMode.value = credentialId.value ? 'saved' : 'new'
  apiKey.value = ''; error.value = ''; notice.value = ''; editing.value = true; deleteId.value = null
}
function cancel(): void { apiKey.value = ''; editing.value = false; current.value = null; error.value = '' }
async function save(): Promise<void> {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    // Write-only key: component-local, never copied into a store, log or history.
    data.value = teamValue(await window.chorus.team.memberSave({
      ...(current.value ? { id: current.value.id } : {}), expectedVersion: current.value?.version ?? null,
      label: label.value, model: model.value, instructions: instructions.value,
      credentialProfileId: credentialMode.value === 'saved' ? credentialId.value : null,
      ...(credentialMode.value === 'new' ? { apiKey: apiKey.value } : {})
    }))
    apiKey.value = ''; editing.value = false; current.value = null; notice.value = 'Member saved. Use it in this team or add another member.'
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function remove(member: TeamMemberProfile): Promise<void> {
  busy.value = true; error.value = ''
  try { data.value = teamValue(await window.chorus.team.memberDelete({ id: member.id, expectedVersion: member.version })); deleteId.value = null; notice.value = 'Member removed. Its saved API credential and previous Team runs are retained.' }
  catch (e) { error.value = String(e) } finally { busy.value = false }
}
</script>
<template>
  <div class="overlay-scrim overlay-scrim-dialog" @keydown.esc.stop="!busy && emit('close')">
    <section class="overlay-panel member-editor" role="dialog" aria-modal="true" aria-labelledby="member-editor-title">
      <header><div><h2 id="member-editor-title">Team members</h2><p>Build a reusable roster of coding helpers.</p></div><button type="button" :disabled="busy" @click="emit('close')">Back to team</button></header>
      <p v-if="loading" role="status">Loading members…</p>
      <template v-else>
        <button v-if="!editing" type="button" class="primary create" :disabled="busy" @click="edit()">Create member</button>
        <form v-if="editing" @submit.prevent="save">
          <h3>{{ current ? 'Edit member' : 'Create member' }}</h3>
          <fieldset :disabled="busy">
            <label>Friendly name<input v-model="label" name="member-name" required maxlength="100" placeholder="Frontend developer" autocomplete="off" /></label>
            <div class="row"><label>Harness<input value="OpenCode" readonly /></label><label>Provider<input value="OpenRouter" readonly /></label></div>
            <label>Model name / ID<input v-model="model" name="member-model" required maxlength="200" placeholder="vendor/model" autocomplete="off" spellcheck="false" /></label>
            <p class="hint">Enter the exact OpenRouter model ID. Custom models can be selected; their coding behavior has not been verified by Chorus.</p>
            <label>API credential<select v-model="credentialMode"><option value="new">Enter a new API key</option><option value="saved" :disabled="!data.credentials.length">Use a saved credential</option></select></label>
            <label v-if="credentialMode === 'new'">API key<input v-model="apiKey" name="member-api-key" type="password" required autocomplete="new-password" spellcheck="false" maxlength="16384" placeholder="Paste your OpenRouter API key" /></label>
            <label v-else>Saved credential<select v-model="credentialId" required><option value="" disabled>Choose a credential</option><option v-for="credential in data.credentials" :key="credential.id" :value="credential.id" :disabled="!credential.available">{{ credential.label }} · {{ credential.providerName }}{{ credential.available ? '' : ' · unavailable' }}</option></select></label>
            <p class="hint">Keys are encrypted on this computer and never shown again. Members can share a saved credential. Entering a different key changes this member’s selection.</p>
            <label>Role instructions (optional)<textarea v-model="instructions" name="member-instructions" rows="3" maxlength="8000" placeholder="Focus on frontend changes, accessibility, and component tests." /></label>
            <p class="hint">Edits apply to future team launches. Active teams keep their existing member settings.</p>
            <div class="actions"><button type="button" @click="cancel">Cancel</button><button class="primary" type="submit">{{ busy ? 'Saving…' : 'Save member' }}</button></div>
          </fieldset>
        </form>
        <div v-for="member in data.profiles" :key="member.id" class="member-row" :data-team-member-id="member.id">
          <div class="identity"><strong>{{ member.label }}</strong><span>{{ member.model }}</span><span class="hint">OpenCode · OpenRouter · {{ data.credentials.find(c => c.id === member.credentialProfileId)?.label ?? 'Credential unavailable' }}</span></div>
          <div class="actions"><button type="button" :disabled="busy" @click="emit('close', member.id)">Use in team</button><button type="button" :disabled="busy" @click="edit(member)">Edit</button><button type="button" :disabled="busy" @click="deleteId = member.id">Delete</button></div>
          <div v-if="deleteId === member.id" class="delete-confirm"><p>Remove this member from your saved roster? Existing teams and its API credential will be retained.</p><button type="button" :disabled="busy" @click="deleteId = null">Keep member</button><button type="button" :disabled="busy" @click="remove(member)">Delete member</button></div>
        </div>
        <p v-if="!editing && !data.profiles.length" class="hint">No saved members yet. Create your first helper above.</p>
      </template>
      <p v-if="notice" role="status" class="notice">{{ notice }}</p><p v-if="error" role="alert" class="error">{{ error }}</p>
    </section>
  </div>
</template>
<style scoped>
.member-editor{width:min(760px,94vw);max-height:88vh;overflow:auto;padding:22px;display:flex;flex-direction:column;gap:16px}header,.row,.actions{display:flex;gap:10px;align-items:center}header{justify-content:space-between}h2{font-size:19px;font-weight:600}h3{font-size:16px;font-weight:600;margin-bottom:12px}header p,.hint{color:var(--color-text-secondary);font-size:12px;line-height:1.5}fieldset{display:flex;flex-direction:column;gap:12px}.row>label{flex:1}label{display:flex;flex-direction:column;gap:6px;font-size:13px}input,select,textarea{width:100%;min-width:0;padding:9px;border:1px solid var(--color-border-divider,#555);border-radius:6px;background:var(--color-bg-secondary,#202226);color:var(--color-text-primary)}input[readonly]{opacity:.7}button{padding:8px 12px;border:1px solid var(--color-border-divider,#555);border-radius:6px;white-space:nowrap}button.primary{background:var(--color-accent,#287a63);color:white}.create{align-self:flex-start}button:disabled{opacity:.45}form{padding:16px;border:1px solid var(--color-border-divider,#555);border-radius:8px}.actions{justify-content:flex-end;flex-wrap:wrap}.member-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 0;border-bottom:1px solid var(--color-border-divider,#555)}.identity{display:flex;flex:1;min-width:180px;flex-direction:column;gap:4px;overflow-wrap:anywhere}.identity>span{font-size:13px}.delete-confirm{flex-basis:100%;font-size:13px}.delete-confirm button{margin-top:8px;margin-right:8px}.notice{font-size:13px;color:var(--color-text-secondary)}.error{color:#ff9c9c;font-size:13px}input:focus,select:focus,textarea:focus,button:focus-visible{outline:2px solid var(--color-accent,#48aa86);outline-offset:2px}
</style>

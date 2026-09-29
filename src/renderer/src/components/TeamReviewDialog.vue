<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TeamFilePreview as Preview, TeamIntegration, TeamReviewPacket } from '../../../shared/team'
import { plainTeamInput, teamValue } from '../stores/team'
import TeamFilePreview from './TeamFilePreview.vue'
const props = defineProps<{ integration: TeamIntegration }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>(), packet = ref<TeamReviewPacket>(), file = ref<Preview>(), path = ref(''), side = ref<'before' | 'after'>('after')
const loading = ref(false), error = ref('')
let request = 0, alive = true
const query = () => ({ runId: props.integration.runId, integrationId: props.integration.id, expectedVersion: props.integration.version })
const orderedPaths = computed(() => [...(packet.value?.paths ?? [])].sort((a, b) => Number(!/\.(pdf|html?|png|jpe?g|webp|svg)$/i.test(a)) - Number(!/\.(pdf|html?|png|jpe?g|webp|svg)$/i.test(b))))
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => { alive = false; request++ })
async function preview() {
  const id = ++request; file.value = undefined; loading.value = true; error.value = ''
  try { const result = teamValue(await window.chorus.team.preview(plainTeamInput({ ...query(), path: path.value, side: side.value }))); if (alive && id === request) file.value = result }
  catch (e) { if (alive && id === request) error.value = String(e) }
  finally { if (alive && id === request) loading.value = false }
}
watch(() => [props.integration.id, props.integration.version], async () => {
  const id = ++request; packet.value = undefined; file.value = undefined; error.value = ''; loading.value = true
  try {
    const result = teamValue(await window.chorus.team.review(plainTeamInput(query())))
    if (!alive || id !== request) return
    packet.value = result; path.value = orderedPaths.value[0] ?? ''; side.value = 'after'
    if (path.value) await preview()
    else loading.value = false
  } catch (e) { if (alive && id === request) { error.value = String(e); loading.value = false } }
}, { immediate: true })
</script>
<template>
  <dialog ref="dialog" class="review-dialog" aria-labelledby="team-review-title" @cancel.prevent="emit('close')">
    <header><div><p class="eyebrow">VIEW OUTPUT</p><h2 id="team-review-title">{{ packet?.title ?? 'Loading saved output…' }}</h2></div><button aria-label="Close review" @click="emit('close')">Close</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="packet">
      <p class="description">{{ packet.explanation.slice(0, 600) }}{{ packet.explanation.length > 600 ? '…' : '' }}</p>
      <div class="review-layout">
        <nav aria-label="Changed files"><p>{{ orderedPaths.length }} changed files</p><button v-for="name in orderedPaths" :key="name" :class="{ selected: path === name }" :aria-pressed="path === name" @click="path = name; preview()">{{ name }}</button></nav>
        <main><div class="version-controls"><strong>{{ path || 'No changed files' }}</strong><label>Version <select v-model="side" @change="preview()"><option value="after">Saved result</option><option value="before">Before changes</option></select></label></div><p v-if="loading" role="status">Loading exact saved file…</p><TeamFilePreview v-if="file" :key="`${file.sha}:${file.path}`" :file="file" /></main>
      </div>
      <details><summary>Checks and full lead review · {{ packet.tests.length }} recorded checks</summary><p class="full-review">{{ packet.explanation }}</p><p v-if="!packet.tests.length">No test evidence was recorded for this prepared version.</p><div v-for="(test, index) in packet.tests" :key="index" class="test"><strong>{{ test.outcome }} · {{ test.provenance }} · {{ test.executionContext }}</strong><code>{{ test.command }}</code><pre>{{ test.output }}</pre></div></details>
      <details><summary>Technical details and source changes</summary><p>Result {{ packet.integration.resultSha }}</p><p v-if="packet.truncated" role="alert">This diff is truncated. Use individual file previews to inspect the complete files.</p><pre>{{ packet.diff }}</pre></details>
    </template>
    <footer><div><p>This is the saved applied version. Later edits may differ.</p><p>The lead continues automatically. Request changes in the lead terminal.</p></div><button @click="emit('close')">Done</button></footer>
  </dialog>
</template>
<style scoped>
.review-dialog{color:#e4eaf1;background:#101419;border:1px solid #425260;border-radius:12px;width:min(1200px,94vw);max-width:94vw;height:90vh;max-height:90vh;margin:auto;padding:22px;overflow:auto;font-size:13px}.review-dialog::backdrop{background:#000b}header,footer,.version-controls{display:flex;align-items:center;justify-content:space-between;gap:16px}header{align-items:flex-start}h2{font-size:19px;margin:4px 0 12px}.eyebrow{font:10px monospace;letter-spacing:2px;color:#8ecfb8}.description{line-height:1.6;white-space:pre-wrap;margin:8px 0 18px}.review-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:18px}nav{max-height:64vh;overflow:auto}nav button{display:block;width:100%;text-align:left;overflow-wrap:anywhere;margin:5px 0;padding:10px}.selected{background:#204239;border-color:#65b799}main{min-width:0}.version-controls{margin-bottom:10px;flex-wrap:wrap}.version-controls strong{overflow-wrap:anywhere;max-width:100%}select{background:#151c22;border:1px solid #54635c;padding:5px;color:inherit}button{border:1px solid #54635c;border-radius:5px;padding:7px 12px}button:disabled{opacity:.4}.approve{background:#205744;border-color:#69ba9c}details{margin-top:16px;padding:12px;border:1px solid #303c47;border-radius:6px}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;font:11px/1.6 monospace}.full-review{white-space:pre-wrap}.test{padding:10px 0}code{display:block;overflow-wrap:anywhere}footer{position:sticky;bottom:-22px;background:#101419;padding:16px 0;border-top:1px solid #425260;margin-top:18px}footer>div{flex:1}footer p{margin-bottom:8px;color:#aab9c6}[role=alert]{color:#ffad9e}@media(max-width:720px){.review-layout{grid-template-columns:1fr}nav{max-height:140px}footer{flex-wrap:wrap}footer>div{flex-basis:100%}}
</style>

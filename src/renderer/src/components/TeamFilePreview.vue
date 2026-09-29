<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { TeamFilePreview } from '../../../shared/team'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
GlobalWorkerOptions.workerSrc = workerUrl
const props = defineProps<{ file: TeamFilePreview }>()
const emit = defineEmits<{ viewed: [] }>()
const canvas = ref<HTMLCanvasElement>(), page = ref(1), pages = ref(0), error = ref(''), rendering = ref(false)
let pdf: PDFDocumentProxy | undefined, loading: ReturnType<typeof getDocument> | undefined, renderTask: RenderTask | undefined, generation = 0
const html = computed(() => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">${props.file.content}`)
async function renderPage() {
  if (!pdf || !canvas.value) return
  const current = generation
  rendering.value = true; error.value = ''
  try {
    const sheet = await pdf.getPage(page.value)
    if (current !== generation || !canvas.value) return
    const base = sheet.getViewport({ scale: 1 }), viewport = sheet.getViewport({ scale: Math.min(1.5, 1600 / Math.max(base.width, base.height)) })
    canvas.value.width = viewport.width; canvas.value.height = viewport.height
    renderTask = sheet.render({ canvas: canvas.value, viewport })
    await renderTask.promise
    if (current === generation) emit('viewed')
  } catch (e) { if (current === generation) error.value = `PDF preview failed: ${String(e)}` }
  finally { if (current === generation) rendering.value = false }
}
watch(() => props.file, async file => {
  const current = ++generation
  renderTask?.cancel(); void loading?.destroy(); pdf = undefined; pages.value = 0; page.value = 1; error.value = ''
  if (file.kind !== 'pdf') { rendering.value = false; if (file.kind === 'text') emit('viewed'); return }
  rendering.value = true
  try {
    loading = getDocument({ data: Uint8Array.from(atob(file.content), c => c.charCodeAt(0)), useWorkerFetch: false })
    const loaded = await loading.promise
    if (current !== generation) return
    pdf = loaded; pages.value = pdf.numPages; await renderPage()
  } catch (e) { if (current === generation) { error.value = `PDF preview failed: ${String(e)}`; rendering.value = false } }
}, { immediate: true, flush: 'post' })
watch(page, () => { if (pdf && !rendering.value) void renderPage() })
onBeforeUnmount(() => { generation++; renderTask?.cancel(); void loading?.destroy() })
</script>
<template>
  <div class="file-preview">
    <p v-if="file.note" class="preview-note">{{ file.note }}</p>
    <iframe v-if="file.kind === 'html'" title="Prepared HTML layout" sandbox="" :srcdoc="html" referrerpolicy="no-referrer" @load="emit('viewed')" />
    <img v-else-if="file.kind === 'image'" :src="file.content" :alt="file.path" @load="emit('viewed')" @error="error = 'Image preview could not be rendered.'" />
    <template v-else-if="file.kind === 'pdf'">
      <div class="pdf-controls"><button :disabled="page <= 1 || rendering" @click="page--">Previous page</button><span>Page {{ page }} of {{ pages || '…' }}</span><button :disabled="page >= pages || rendering" @click="page++">Next page</button></div>
      <p v-if="rendering" role="status">Rendering PDF…</p><canvas ref="canvas" :aria-label="`PDF page ${page}`" />
    </template>
    <pre v-else-if="file.kind === 'text'">{{ file.content }}</pre>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.file-preview{min-width:0;overflow:auto;background:#151a20;padding:12px;border-radius:8px}.preview-note{color:#b7c3d1;font-size:12px;margin-bottom:12px}iframe{width:100%;height:58vh;border:0;background:white}img,canvas{display:block;max-width:100%;height:auto;margin:auto;background:white}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 monospace}.pdf-controls{display:flex;gap:15px;align-items:center;justify-content:center;margin-bottom:12px}button{border:1px solid #54635c;border-radius:5px;padding:6px 10px}button:disabled{opacity:.4}[role=alert]{color:#ffad9e}
</style>
